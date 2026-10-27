import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Merchant } from '../entities/merchant.entity';
import { MerchantApiKey } from '../entities/merchant-api-key.entity';
import { MerchantGroup } from '../entities/merchant-group.entity';
import { MerchantChanges } from '../types/merchant-changes';
import { MerchantListQuery } from '../types/merchant-list-query';
import { MerchantStatus } from '../types/merchant-status.enum';
import { MerchantTreeNode } from '../types/merchant-tree-node';
import { MerchantCurrenciesService } from './merchant-currencies.service';
import { MerchantGroupsService } from './merchant-groups.service';

const containsFolded = (value: string | null, term: string): boolean =>
  value !== null && value.toLowerCase().includes(term);

@Injectable()
export class MerchantsService {
  constructor(
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectRepository(MerchantApiKey)
    private readonly keys: Repository<MerchantApiKey>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly groups: MerchantGroupsService,
    private readonly currencies: MerchantCurrenciesService,
    private readonly audit: AuditService,
  ) {}

  findById(id: string): Promise<Merchant | null> {
    return this.merchants.findOne({ where: { id } });
  }

  findWithGroup(id: string): Promise<Merchant | null> {
    return this.merchants.findOne({
      where: { id },
      relations: { group: true },
    });
  }

  async findByIds(ids: string[]): Promise<Merchant[]> {
    if (ids.length === 0) return [];

    return this.merchants.find({ where: { id: In(ids) } });
  }

  async rankByName(): Promise<Map<string, number>> {
    const merchants = await this.merchants.find({
      select: { id: true, name: true },
      order: { name: 'ASC', id: 'ASC' },
    });
    const ranks = new Map<string, number>();
    let rank = -1;
    let previousName: string | undefined;

    for (const merchant of merchants) {
      if (merchant.name !== previousName) rank++;
      previousName = merchant.name;
      ranks.set(merchant.id, rank);
    }

    return ranks;
  }

  create(name: string, manager?: EntityManager): Promise<Merchant> {
    const repository = manager
      ? manager.getRepository(Merchant)
      : this.merchants;

    return repository.save(repository.create({ name }));
  }

  async createKey(
    merchantId: string,
    actorUserId: string,
  ): Promise<MerchantApiKey> {
    return this.dataSource.transaction(async (manager) => {
      await this.requireWithin(manager, merchantId);

      const key = await manager.save(
        manager.create(MerchantApiKey, {
          merchantId,
          key: randomUUID(),
          secret: randomBytes(32).toString('hex'),
        }),
      );

      await this.audit.record(
        {
          actorUserId,
          action: 'merchant.api_key_issued',
          metadata: { merchantId, apiKeyId: key.id },
        },
        manager,
      );

      return key;
    });
  }

  listKeys(merchantId: string): Promise<MerchantApiKey[]> {
    return this.keys.find({
      where: { merchantId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async revokeKey(
    merchantId: string,
    keyId: number,
    actorUserId: string,
  ): Promise<MerchantApiKey> {
    return this.dataSource.transaction(async (manager) => {
      await this.requireWithin(manager, merchantId);

      const key = await manager.findOne(MerchantApiKey, {
        where: { id: keyId, merchantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!key) throw new NotFoundException('API key not found');

      if (!key.active) return key;

      key.active = false;
      key.revokedAt = new Date();
      await manager.save(key);

      await this.audit.record(
        {
          actorUserId,
          action: 'merchant.api_key_revoked',
          metadata: { merchantId, apiKeyId: key.id },
        },
        manager,
      );

      return key;
    });
  }

  private async requireWithin(
    manager: EntityManager,
    merchantId: string,
  ): Promise<void> {
    const merchant = await manager.findOne(Merchant, {
      where: { id: merchantId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!merchant) throw new NotFoundException('Merchant not found');
  }

  async listTree(query: MerchantListQuery): Promise<MerchantTreeNode[]> {
    const all = await this.merchants.find({
      relations: { group: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const term = query.search?.toLowerCase();
    const passesFlags = (merchant: Merchant): boolean =>
      (query.status === undefined ||
        merchant.active === (query.status === MerchantStatus.Active)) &&
      (query.exclusiveTopUp === undefined ||
        merchant.exclusiveTopUp === query.exclusiveTopUp);
    const matchesTerm = (merchant: Merchant): boolean =>
      !term ||
      merchant.id.includes(term) ||
      containsFolded(merchant.name, term) ||
      containsFolded(merchant.internalName, term);
    const groupMatches = (group: MerchantGroup | null): boolean =>
      Boolean(term && group && containsFolded(group.name, term));

    const nodes: MerchantTreeNode[] = [];
    const groupNodes = new Map<
      number,
      Extract<MerchantTreeNode, { kind: 'group' }>
    >();

    for (const merchant of all) {
      if (merchant.group) {
        let node = groupNodes.get(merchant.group.id);

        if (!node) {
          node = {
            kind: 'group',
            group: merchant.group,
            members: [],
            shown: [],
          };
          groupNodes.set(merchant.group.id, node);
          nodes.push(node);
        }
        node.members.push(merchant);
        if (
          passesFlags(merchant) &&
          (matchesTerm(merchant) || groupMatches(merchant.group))
        ) {
          node.shown.push(merchant);
        }
      } else if (passesFlags(merchant) && matchesTerm(merchant)) {
        nodes.push({ kind: 'merchant', merchant });
      }
    }

    return nodes.filter(
      (node) => node.kind === 'merchant' || node.shown.length,
    );
  }

  async update(
    id: string,
    changes: MerchantChanges,
    actorUserId: string,
  ): Promise<Merchant> {
    await this.dataSource.transaction(async (manager) => {
      const lockedGroupId =
        changes.groupId === undefined
          ? undefined
          : await this.lockGroupsOf(manager, id, changes.groupId);

      const merchant = await manager.findOne(Merchant, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!merchant) throw new NotFoundException('Merchant not found');

      if (lockedGroupId !== undefined && merchant.groupId !== lockedGroupId) {
        throw new ConflictException(
          'The merchant changed group meanwhile; try again',
        );
      }

      if (changes.currencyIds !== undefined) {
        await this.currencies.assertCurrenciesExistWithin(
          manager,
          changes.currencyIds,
        );
      }

      const { groupId, currencyIds, defaultCurrencyId, ...fields } = changes;
      const written = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );

      if (Object.keys(written).length) {
        await manager.update(Merchant, id, written);
      }

      if (groupId !== undefined) {
        await this.groups.moveWithin(manager, merchant, groupId, actorUserId);
      }

      if (currencyIds !== undefined || defaultCurrencyId !== undefined) {
        await this.currencies.replaceWithin(manager, id, {
          currencyIds,
          defaultCurrencyId,
        });
      }

      await this.audit.record(
        {
          actorUserId,
          action: 'merchant.updated',
          metadata: { merchantId: id, ...changes },
        },
        manager,
      );
    });

    return (await this.merchants.findOne({
      where: { id },
      relations: { group: true },
    })) as Merchant;
  }

  private async lockGroupsOf(
    manager: EntityManager,
    id: string,
    targetGroupId: number | null,
  ): Promise<number | null> {
    const current = await manager.findOne(Merchant, { where: { id } });

    if (!current) throw new NotFoundException('Merchant not found');

    await this.groups.lockGroupsWithin(manager, [
      current.groupId,
      targetGroupId,
    ]);

    return current.groupId;
  }
}
