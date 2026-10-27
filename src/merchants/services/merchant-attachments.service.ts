import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Role } from '../../common/enums/role.enum';
import { loginOf } from '../../common/utils/login-of';
import { TransactionMethodDefinition } from '../../transactions/types/transaction-method-definition';
import { findTransactionMethod } from '../../transactions/utils/find-transaction-method';
import { TRANSACTION_METHODS } from '../../transactions/utils/transaction-methods';
import { User } from '../../users/entities/user.entity';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { MerchantAttachmentMethod } from '../entities/merchant-attachment-method.entity';
import { MerchantAttachment } from '../entities/merchant-attachment.entity';
import { Merchant } from '../entities/merchant.entity';
import { AttachmentChanges } from '../types/attachment-changes';
import { AttachmentCounts } from '../types/attachment-counts';
import { AttachmentMethodState } from '../types/attachment-method-state';
import { AttachmentSet } from '../types/attachment-set';
import { AttachmentView } from '../types/attachment-view';
import { MerchantAttachmentKind } from '../types/merchant-attachment-kind.enum';
import { isUniqueViolation } from '../utils/is-unique-violation';

const REGISTRY: readonly TransactionMethodDefinition[] = TRANSACTION_METHODS;

const ROLE_OF_KIND: Record<MerchantAttachmentKind, Role> = {
  [MerchantAttachmentKind.Trader]: Role.Trader,
  [MerchantAttachmentKind.Cascade]: Role.Cascade,
};

const ATTACHMENT_NOT_FOUND = 'This account is not attached to the merchant';

const methodStatesOf = (
  rows: { method: string; enabled: boolean }[],
): AttachmentMethodState[] => {
  const byMethod = new Map(rows.map((row) => [row.method, row.enabled]));

  return REGISTRY.map(({ code }) => ({
    method: code,
    enabled: byMethod.get(code) ?? false,
  }));
};

const assertMethodsValid = (methods: AttachmentMethodState[]): void => {
  const seen = new Set<string>();

  for (const entry of methods) {
    if (!findTransactionMethod(entry.method)) {
      throw new BadRequestException(`Unknown method ${entry.method}`);
    }
    if (seen.has(entry.method)) {
      throw new BadRequestException(
        `Method ${entry.method} appears more than once`,
      );
    }
    seen.add(entry.method);
  }
};

@Injectable()
export class MerchantAttachmentsService {
  constructor(
    @InjectRepository(MerchantAttachment)
    private readonly attachments: Repository<MerchantAttachment>,
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly directory: UserDirectoryService,
    private readonly audit: AuditService,
  ) {}

  async countsByMerchant(
    merchantIds: string[],
  ): Promise<Map<string, AttachmentCounts>> {
    const counts = new Map<string, AttachmentCounts>(
      merchantIds.map((id) => [id, { traders: 0, cascades: 0 }]),
    );

    if (!merchantIds.length) return counts;

    const rows = await this.attachments.find({
      where: { merchantId: In(merchantIds) },
      select: { merchantId: true, kind: true },
    });

    for (const row of rows) {
      const entry = counts.get(row.merchantId);

      if (!entry) continue;
      if (row.kind === MerchantAttachmentKind.Trader) entry.traders++;
      else entry.cascades++;
    }

    return counts;
  }

  async list(merchantId: string): Promise<AttachmentView[]> {
    await this.requireMerchant(merchantId);

    return this.viewsOf(
      await this.attachments.find({
        where: { merchantId },
        relations: { methods: true },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    );
  }

  async replace(
    merchantId: string,
    set: AttachmentSet,
    actorUserId: string,
  ): Promise<AttachmentView[]> {
    const entries = [
      ...set.traders.map((entry) => ({
        ...entry,
        kind: MerchantAttachmentKind.Trader,
      })),
      ...set.cascades.map((entry) => ({
        ...entry,
        kind: MerchantAttachmentKind.Cascade,
      })),
    ];
    const userIds = entries.map((entry) => entry.userId);

    if (new Set(userIds).size !== userIds.length) {
      throw new BadRequestException('An account appears more than once');
    }
    for (const entry of entries) assertMethodsValid(entry.methods);

    await this.requireMerchant(merchantId);

    const users = new Map(
      (await this.directory.findByIds(userIds)).map((user) => [user.id, user]),
    );

    for (const entry of entries) {
      const user = users.get(entry.userId);

      if (!user) throw new BadRequestException('Unknown account in the list');
      if (user.role !== ROLE_OF_KIND[entry.kind]) {
        throw new BadRequestException(
          `Account ${loginOf(user)} is not a ${ROLE_OF_KIND[entry.kind]}`,
        );
      }
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `merchant_attachments:${merchantId}`,
        ]);

        const existing = await manager.find(MerchantAttachment, {
          where: { merchantId },
        });
        const kept = new Set(userIds);
        const dropped = existing.filter((row) => !kept.has(row.userId));

        if (dropped.length) {
          await manager.delete(MerchantAttachment, {
            id: In(dropped.map((row) => row.id)),
          });
        }

        const byUser = new Map(existing.map((row) => [row.userId, row]));

        for (const entry of entries) {
          const current = byUser.get(entry.userId);
          const attachment = current
            ? await manager.save(
                manager.merge(MerchantAttachment, current, {
                  kind: entry.kind,
                  trading: entry.trading,
                }),
              )
            : await manager.save(
                manager.create(MerchantAttachment, {
                  merchantId,
                  userId: entry.userId,
                  kind: entry.kind,
                  trading: entry.trading,
                }),
              );

          await this.writeMethodsWithin(manager, attachment.id, entry.methods);
        }

        await this.audit.record(
          {
            actorUserId,
            action: 'merchant.attachments_replaced',
            metadata: {
              merchantId,
              traders: set.traders.map((entry) => entry.userId),
              cascades: set.cascades.map((entry) => entry.userId),
            },
          },
          manager,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'The attachments were changed at the same time; try again',
        );
      }
      throw error;
    }

    return this.list(merchantId);
  }

  async update(
    merchantId: string,
    userId: string,
    changes: AttachmentChanges,
    actorUserId: string,
  ): Promise<AttachmentView> {
    if (changes.methods) assertMethodsValid(changes.methods);

    const updated = await this.dataSource.transaction(async (manager) => {
      const attachment = await manager.findOne(MerchantAttachment, {
        where: { merchantId, userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!attachment) throw new NotFoundException(ATTACHMENT_NOT_FOUND);

      if (changes.trading !== undefined) {
        await manager.update(MerchantAttachment, attachment.id, {
          trading: changes.trading,
        });
      }

      if (changes.methods) {
        const current = await manager.find(MerchantAttachmentMethod, {
          where: { attachmentId: attachment.id },
        });
        const merged = new Map(current.map((row) => [row.method, row.enabled]));

        for (const entry of changes.methods) {
          merged.set(entry.method, entry.enabled);
        }

        await this.writeMethodsWithin(
          manager,
          attachment.id,
          [...merged].map(([method, enabled]) => ({ method, enabled })),
        );
      }

      await this.audit.record(
        {
          actorUserId,
          targetUserId: userId,
          action: 'merchant.attachment_updated',
          metadata: { merchantId, ...changes },
        },
        manager,
      );

      return manager.find(MerchantAttachment, {
        where: { merchantId, userId },
        relations: { methods: true },
      });
    });

    const [view] = await this.viewsOf(updated);

    return view;
  }

  async remove(
    merchantId: string,
    userId: string,
    actorUserId: string,
  ): Promise<AttachmentView[]> {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.delete(MerchantAttachment, {
        merchantId,
        userId,
      });

      if (!result.affected) throw new NotFoundException(ATTACHMENT_NOT_FOUND);

      await this.audit.record(
        {
          actorUserId,
          targetUserId: userId,
          action: 'merchant.attachment_removed',
          metadata: { merchantId },
        },
        manager,
      );
    });

    return this.list(merchantId);
  }

  private async writeMethodsWithin(
    manager: EntityManager,
    attachmentId: number,
    methods: AttachmentMethodState[],
  ): Promise<void> {
    await manager.delete(MerchantAttachmentMethod, { attachmentId });

    if (!methods.length) return;

    await manager.save(
      methods.map((entry) =>
        manager.create(MerchantAttachmentMethod, {
          attachmentId,
          method: entry.method,
          enabled: entry.enabled,
        }),
      ),
    );
  }

  private async viewsOf(rows: MerchantAttachment[]): Promise<AttachmentView[]> {
    const users = new Map<string, User>(
      (await this.directory.findByIds(rows.map((row) => row.userId))).map(
        (user) => [user.id, user],
      ),
    );

    return rows.flatMap((row) => {
      const user = users.get(row.userId);

      return user
        ? [
            {
              userId: row.userId,
              login: loginOf(user),
              status: user.status,
              kind: row.kind,
              trading: row.trading,
              methods: methodStatesOf(row.methods ?? []),
            },
          ]
        : [];
    });
  }

  private async requireMerchant(merchantId: string): Promise<void> {
    if (!(await this.merchants.findOne({ where: { id: merchantId } }))) {
      throw new NotFoundException('Merchant not found');
    }
  }
}
