import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import {
  And,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Crypto } from '../../common/types/crypto';
import { Page, toPage } from '../../common/types/page';
import { formatCrypto } from '../../common/utils/format-crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { sortDirection } from '../../common/utils/sort-direction';
import { toCrypto } from '../../common/utils/to-crypto';
import { MerchantBalanceOperation } from '../entities/merchant-balance-operation.entity';
import { MerchantBalance } from '../entities/merchant-balance.entity';
import { MerchantBalanceAdjustment } from '../types/merchant-balance-adjustment';
import { MerchantBalanceOperationFilter } from '../types/merchant-balance-operation-filter';
import { MerchantBalanceOperationListQuery } from '../types/merchant-balance-operation-list-query';
import { MerchantBalanceOperationType } from '../types/merchant-balance-operation-type.enum';
import { MerchantBalanceState } from '../types/merchant-balance-state';

interface Movement {
  type: MerchantBalanceOperationType;
  balanceDelta: Decimal;
  escrowDelta: Decimal;
  transactionId: string | null;
  comment?: string | null;
  actorUserId?: string | null;
}

const RESOLVING_TYPES = [
  MerchantBalanceOperationType.DealPayOut,
  MerchantBalanceOperationType.DealPayOutEscrowRelease,
];

const ZERO = toCrypto(0);

const createdAtRange = ({ from, to }: MerchantBalanceOperationFilter) => {
  if (from && to) return And(MoreThanOrEqual(from), LessThan(to));
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThan(to);

  return undefined;
};

const operationWhere = (
  merchantBalanceId: number,
  filter: MerchantBalanceOperationFilter,
): FindOptionsWhere<MerchantBalanceOperation> => {
  const createdAt = createdAtRange(filter);

  return {
    merchantBalanceId,
    ...(createdAt ? { createdAt } : {}),
    ...(filter.types?.length ? { type: In(filter.types) } : {}),
  };
};

@Injectable()
export class MerchantBalanceService {
  constructor(
    @InjectRepository(MerchantBalance)
    private readonly balances: Repository<MerchantBalance>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async balancesByMerchant(
    merchantIds: string[],
  ): Promise<Map<string, Crypto>> {
    const states = await this.statesByMerchant(merchantIds);

    return new Map(
      [...states].map(([merchantId, state]) => [merchantId, state.balance]),
    );
  }

  async statesByMerchant(
    merchantIds: string[],
  ): Promise<Map<string, MerchantBalanceState>> {
    const rows = merchantIds.length
      ? await this.balances.find({ where: { merchantId: In(merchantIds) } })
      : [];
    const byMerchant = new Map(rows.map((row) => [row.merchantId, row]));

    return new Map(
      merchantIds.map((merchantId) => {
        const row = byMerchant.get(merchantId);

        return [
          merchantId,
          { balance: row?.balance ?? ZERO, escrow: row?.escrow ?? ZERO },
        ];
      }),
    );
  }

  async creditDealWithin(
    manager: EntityManager,
    merchantId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<MerchantBalanceOperation | null> {
    if (
      await this.hasOperation(manager, transactionId, [
        MerchantBalanceOperationType.DealPayIn,
      ])
    ) {
      return null;
    }

    return this.moveWithin(manager, merchantId, {
      type: MerchantBalanceOperationType.DealPayIn,
      balanceDelta: amount,
      escrowDelta: ZERO,
      transactionId,
    });
  }

  holdPayOutWithin(
    manager: EntityManager,
    merchantId: string,
    amount: Crypto,
    transactionId: string,
    allowsOverdraft: () => Promise<boolean>,
  ): Promise<MerchantBalanceOperation> {
    return this.moveWithin(
      manager,
      merchantId,
      {
        type: MerchantBalanceOperationType.DealPayOutEscrow,
        balanceDelta: amount.neg(),
        escrowDelta: amount,
        transactionId,
      },
      async (balance) => {
        if (balance.balance.gte(amount)) return;

        if (!(await allowsOverdraft())) {
          throw new ConflictException(
            'The merchant balance does not cover the pay-out',
          );
        }
      },
    );
  }

  async settlePayOutWithin(
    manager: EntityManager,
    merchantId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<MerchantBalanceOperation | null> {
    if (await this.hasOperation(manager, transactionId, RESOLVING_TYPES)) {
      return null;
    }

    const held = await this.heldAmount(manager, transactionId);

    return this.moveWithin(manager, merchantId, {
      type: MerchantBalanceOperationType.DealPayOut,
      balanceDelta: held ? ZERO : amount.neg(),
      escrowDelta: held ? held.neg() : ZERO,
      transactionId,
    });
  }

  async releasePayOutWithin(
    manager: EntityManager,
    merchantId: string,
    transactionId: string,
  ): Promise<MerchantBalanceOperation | null> {
    if (await this.hasOperation(manager, transactionId, RESOLVING_TYPES)) {
      return null;
    }

    const held = await this.heldAmount(manager, transactionId);

    if (!held) return null;

    return this.moveWithin(manager, merchantId, {
      type: MerchantBalanceOperationType.DealPayOutEscrowRelease,
      balanceDelta: held,
      escrowDelta: held.neg(),
      transactionId,
    });
  }

  adjust(
    adjustment: MerchantBalanceAdjustment,
  ): Promise<MerchantBalanceOperation> {
    const signed =
      adjustment.direction === 'credit'
        ? adjustment.amount
        : adjustment.amount.neg();

    return this.dataSource.transaction(async (manager) => {
      const operation = await this.moveWithin(manager, adjustment.merchantId, {
        type: MerchantBalanceOperationType.AdminAdjustment,
        balanceDelta: signed,
        escrowDelta: ZERO,
        transactionId: null,
        comment: adjustment.comment,
        actorUserId: adjustment.actorUserId,
      });

      await this.audit.record(
        {
          actorUserId: adjustment.actorUserId,
          action: 'merchant.balance_adjusted',
          metadata: {
            merchantId: adjustment.merchantId,
            operationId: operation.id,
            amount: formatCrypto(operation.amount),
            balanceBefore: formatCrypto(operation.balanceBefore),
            balanceAfter: formatCrypto(operation.balanceAfter),
            comment: adjustment.comment,
          },
        },
        manager,
      );

      return operation;
    });
  }

  async listOperations(
    query: MerchantBalanceOperationListQuery,
  ): Promise<Page<MerchantBalanceOperation>> {
    const balance = await this.balances.findOne({
      where: { merchantId: query.merchantId },
    });

    if (!balance) return toPage([[], 0], query);

    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.dataSource
        .getRepository(MerchantBalanceOperation)
        .findAndCount({
          where: operationWhere(balance.id, query),
          order: { createdAt: direction, id: direction },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      query,
    );
  }

  async exportOperations(
    filter: MerchantBalanceOperationFilter,
    maxRows: number,
  ): Promise<MerchantBalanceOperation[]> {
    const balance = await this.balances.findOne({
      where: { merchantId: filter.merchantId },
    });

    if (!balance) return [];

    const rows = await this.dataSource
      .getRepository(MerchantBalanceOperation)
      .find({
        where: operationWhere(balance.id, filter),
        order: { createdAt: 'DESC', id: 'DESC' },
        take: maxRows + 1,
      });

    if (rows.length > maxRows) {
      throw new BadRequestException(
        `More than ${maxRows} operations match; narrow the period or the filters`,
      );
    }

    return rows;
  }

  private async hasOperation(
    manager: EntityManager,
    transactionId: string,
    types: MerchantBalanceOperationType[],
  ): Promise<boolean> {
    return (
      (await manager.count(MerchantBalanceOperation, {
        where: { transactionId, type: In(types) },
      })) > 0
    );
  }

  private async heldAmount(
    manager: EntityManager,
    transactionId: string,
  ): Promise<Crypto | null> {
    const hold = await manager.findOne(MerchantBalanceOperation, {
      where: {
        transactionId,
        type: MerchantBalanceOperationType.DealPayOutEscrow,
      },
    });

    return hold ? toCrypto(hold.escrowAfter.minus(hold.escrowBefore)) : null;
  }

  private async moveWithin(
    manager: EntityManager,
    merchantId: string,
    movement: Movement,
    check?: (balance: MerchantBalance) => Promise<void>,
  ): Promise<MerchantBalanceOperation> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(MerchantBalance)
      .values({ merchantId })
      .orIgnore()
      .execute();

    const balance = (await manager.findOne(MerchantBalance, {
      where: { merchantId },
      lock: { mode: 'pessimistic_write' },
    })) as MerchantBalance;

    await check?.(balance);

    const before = balance.balance;
    const after = roundCrypto(before.plus(movement.balanceDelta));
    const escrowBefore = balance.escrow;
    const escrowAfter = roundCrypto(escrowBefore.plus(movement.escrowDelta));

    balance.balance = after;
    balance.escrow = escrowAfter;
    await manager.save(balance);

    return manager.save(
      manager.create(MerchantBalanceOperation, {
        merchantBalanceId: balance.id,
        type: movement.type,
        transactionId: movement.transactionId,
        amount: roundCrypto(after.minus(before)),
        balanceBefore: before,
        balanceAfter: after,
        escrowBefore,
        escrowAfter,
        comment: movement.comment ?? null,
        actorUserId: movement.actorUserId ?? null,
      }),
    );
  }
}
