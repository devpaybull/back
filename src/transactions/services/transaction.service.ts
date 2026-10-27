import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Page, toPage } from '../../common/types/page';
import { FIAT_SCALE } from '../../common/utils/fiat-scale';
import { RATE_SCALE } from '../../common/utils/rate-scale';
import { sortDirection } from '../../common/utils/sort-direction';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { UserTeamService } from '../../users/services/user-team.service';
import { Transaction } from '../entities/transaction.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { CreateDealInput } from '../types/create-deal-input';
import { StatusChange } from '../types/status-change';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionListQuery } from '../types/transaction-list-query';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { DealComputation } from '../types/deal-computation';
import {
  computeDeal,
  PlatformMinimumUnreachableError,
} from '../utils/compute-deal';
import { findTransactionMethod } from '../utils/find-transaction-method';
import {
  canTransition,
  isFinalStatus,
  startStatus,
} from '../utils/status-transitions';
import { transactionListOrder } from '../utils/transaction-list-order';
import { transactionListWhere } from '../utils/transaction-list-where';
import { RateService } from './rate.service';
import { MerchantBalanceService } from './merchant-balance.service';
import { WalletService } from './wallet.service';

const MINUTE_MS = 60_000;
const MERCHANT_NAME_RANK =
  '(CAST(:merchantRankValues AS int[]))[array_position(CAST(:merchantRankIds AS uuid[]), transaction.merchantId)]';

@Injectable()
export class TransactionService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    private readonly wallets: WalletService,
    private readonly merchantBalances: MerchantBalanceService,
    private readonly audit: AuditService,
    private readonly rates: RateService,
    private readonly team: UserTeamService,
    private readonly merchantSettings: MerchantSettingsService,
    private readonly config: ConfigService,
  ) {}

  findById(id: string): Promise<Transaction | null> {
    return this.transactions.findOne({ where: { id } });
  }

  findTraderWindow(userId: string, since: Date): Promise<Transaction[]> {
    return this.transactions.find({
      where: { traderUserId: userId, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'ASC' },
    });
  }

  async list(query: TransactionListQuery): Promise<Page<Transaction>> {
    if (query.bankDetailsIds?.length === 0) return toPage([[], 0], query);

    const where = transactionListWhere(query);
    const skip = (query.page - 1) * query.limit;
    const take = query.limit;

    if (query.sortBy === TransactionSortField.Merchant) {
      return toPage(
        await this.listByMerchantName(query, where, skip, take),
        query,
      );
    }

    return toPage(
      await this.transactions.findAndCount({
        where,
        order: transactionListOrder(query),
        skip,
        take,
      }),
      query,
    );
  }

  private listByMerchantName(
    query: TransactionListQuery,
    where: FindOptionsWhere<Transaction>,
    skip: number,
    take: number,
  ): Promise<[Transaction[], number]> {
    const direction = sortDirection(query.sortOrder);
    const ranks = [...(query.merchantRanks ?? new Map<string, number>())];

    return this.transactions
      .createQueryBuilder('transaction')
      .setFindOptions({ where })
      .orderBy(
        MERCHANT_NAME_RANK,
        direction,
        direction === 'ASC' ? 'NULLS LAST' : 'NULLS FIRST',
      )
      .addOrderBy('transaction.id', direction)
      .setParameters({
        merchantRankIds: ranks.map(([merchantId]) => merchantId),
        merchantRankValues: ranks.map(([, rank]) => rank),
      })
      .skip(skip)
      .take(take)
      .getManyAndCount();
  }

  async createDeal(input: CreateDealInput): Promise<Transaction> {
    const method = findTransactionMethod(input.method);

    if (!method) {
      throw new BadRequestException(`Unknown method ${input.method}`);
    }

    if (!method.directions.includes(input.kind)) {
      throw new BadRequestException(
        `Method ${input.method} does not work for ${input.kind}`,
      );
    }

    if (input.amountFiat.decimalPlaces() > FIAT_SCALE) {
      throw new BadRequestException(
        `amountFiat must have at most ${FIAT_SCALE} decimal places`,
      );
    }

    if (input.rate.decimalPlaces() > RATE_SCALE) {
      throw new BadRequestException(
        `rate must have at most ${RATE_SCALE} decimal places`,
      );
    }

    const leads = await this.rates.resolveLeadPercents({
      links: await this.team.assignmentsOf(input.traderUserId),
      method: input.method,
      amount: input.amountFiat,
      bankId: input.bankId ?? null,
      direction: input.kind === TransactionKind.PayIn ? 'payIn' : 'payOut',
    });
    const platformMinPercent =
      method.platformMinPercent ??
      this.config.getOrThrow<number>('PLATFORM_MIN_PERCENT');

    let computation: DealComputation;
    try {
      computation = computeDeal({
        kind: input.kind,
        amountFiat: input.amountFiat,
        rate: input.rate,
        merchantPercent: input.merchantPercent,
        traderPercent: input.traderPercent,
        platformMinPercent,
        leads,
      });
    } catch (error) {
      if (error instanceof PlatformMinimumUnreachableError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
    const holdsMerchant =
      input.kind === TransactionKind.PayOut && Boolean(input.merchantId);
    const status = startStatus(input.kind);
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() +
        this.config.getOrThrow<number>('DEAL_TTL_MINUTES') * MINUTE_MS,
    );

    return this.dataSource.transaction(async (manager) => {
      if (input.kind === TransactionKind.PayIn) {
        await this.wallets.reserveMainEscrowWithin(
          manager,
          input.traderUserId,
          computation.traderAmount,
        );
      }

      const transaction = manager.create(Transaction, {
        kind: input.kind,
        status,
        method: input.method,
        traderUserId: input.traderUserId,
        bankDetailsId: input.bankDetailsId,
        merchantId: input.merchantId,
        counterpartyId: input.counterpartyId ?? null,
        amountFiat: input.amountFiat,
        amountCrypto: computation.amountCrypto,
        rate: input.rate,
        merchantPercent: input.merchantPercent,
        traderPercent: input.traderPercent,
        traderEffectivePercent: computation.traderEffectivePercent,
        leadPercent: computation.leadPercent,
        merchantCommission: computation.merchantCommission,
        traderCommission: computation.traderCommission,
        leadCommission: computation.leadCommission,
        traderAmount: computation.traderAmount,
        merchantAmount: computation.merchantAmount,
        comment: input.comment ?? null,
        createdAt,
        expiresAt,
      });
      await manager.save(transaction);
      if (holdsMerchant) {
        await this.merchantBalances.holdPayOutWithin(
          manager,
          input.merchantId,
          computation.merchantAmount,
          transaction.id,
          () =>
            this.merchantSettings.allowsOverdraftWithin(
              manager,
              input.merchantId,
            ),
        );
      }
      if (computation.leadShares.length) {
        await manager.save(
          computation.leadShares.map((share) =>
            manager.create(TransactionLeadShare, {
              transactionId: transaction.id,
              leadUserId: share.leadUserId,
              percent: share.percent,
              amount: share.amount,
            }),
          ),
        );
      }
      await this.writeEvent(manager, transaction.id, null, {
        toStatus: status,
        source: StatusEventSource.System,
      });
      return transaction;
    });
  }

  async transition(
    transactionId: string,
    change: StatusChange,
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const transaction = await manager.findOne(Transaction, {
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transaction) throw new NotFoundException('Transaction not found');

      return this.transitionLocked(manager, transaction, change);
    });
  }

  async transitionLocked(
    manager: EntityManager,
    transaction: Transaction,
    change: StatusChange,
  ): Promise<Transaction> {
    if (
      transaction.status === change.toStatus &&
      isFinalStatus(change.toStatus)
    ) {
      return transaction;
    }

    if (!canTransition(transaction.kind, transaction.status, change.toStatus)) {
      throw new ConflictException('Illegal status transition');
    }

    const from = transaction.status;
    transaction.status = change.toStatus;

    if (isFinalStatus(change.toStatus)) {
      transaction.resolvedAt = new Date();
      await this.applySettlement(manager, transaction, change.toStatus);
    }

    await manager.save(transaction);
    await this.writeEvent(manager, transaction.id, from, change);
    return transaction;
  }

  private async applySettlement(
    manager: EntityManager,
    transaction: Transaction,
    toStatus: TransactionStatus,
  ): Promise<void> {
    const settled =
      toStatus === TransactionStatus.Success ||
      toStatus === TransactionStatus.SuccessChanged;

    const isDeal =
      transaction.kind === TransactionKind.PayIn ||
      transaction.kind === TransactionKind.PayOut;

    if (settled && isDeal) {
      await this.creditLeadShares(manager, transaction);
    }

    if (transaction.kind === TransactionKind.PayIn) {
      if (settled) {
        await this.wallets.debitMainWithin(
          manager,
          transaction.traderUserId,
          transaction.traderAmount,
          transaction.id,
        );
      } else if (toStatus === TransactionStatus.Canceled) {
        await this.wallets.releaseEscrowWithin(
          manager,
          transaction.traderUserId,
          transaction.traderAmount,
        );
      }
    } else if (transaction.kind === TransactionKind.PayOut && settled) {
      await this.wallets.creditMainWithin(
        manager,
        transaction.traderUserId,
        transaction.traderAmount,
        transaction.id,
      );
    }

    if (settled && isDeal && transaction.merchantId) {
      await this.settleMerchantBalance(manager, transaction);
    } else if (
      toStatus === TransactionStatus.Canceled &&
      transaction.kind === TransactionKind.PayOut &&
      transaction.merchantId
    ) {
      await this.merchantBalances.releasePayOutWithin(
        manager,
        transaction.merchantId,
        transaction.id,
      );
    }
  }

  private async settleMerchantBalance(
    manager: EntityManager,
    transaction: Transaction,
  ): Promise<void> {
    if (transaction.kind === TransactionKind.PayIn) {
      await this.merchantBalances.creditDealWithin(
        manager,
        transaction.merchantId,
        transaction.merchantAmount,
        transaction.id,
      );
    } else {
      await this.merchantBalances.settlePayOutWithin(
        manager,
        transaction.merchantId,
        transaction.merchantAmount,
        transaction.id,
      );
    }
  }

  private async creditLeadShares(
    manager: EntityManager,
    transaction: Transaction,
  ): Promise<void> {
    const shares = (
      await manager.find(TransactionLeadShare, {
        where: { transactionId: transaction.id },
        order: { id: 'ASC' },
      })
    ).filter((share) => share.amount.gt(0));
    const leadUserIds = shares.map((share) => share.leadUserId);

    await this.wallets.lockWalletsWithin(
      manager,
      [transaction.traderUserId, ...leadUserIds],
      leadUserIds,
    );

    for (const share of shares) {
      await this.wallets.creditLeadShareWithin(
        manager,
        share.leadUserId,
        share.amount,
        transaction.id,
      );
    }
  }

  private async writeEvent(
    manager: EntityManager,
    transactionId: string,
    fromStatus: TransactionStatus | null,
    change: StatusChange,
  ): Promise<void> {
    const event = manager.create(TransactionStatusEvent, {
      transactionId,
      fromStatus,
      toStatus: change.toStatus,
      source: change.source,
      actorUserId: change.actorUserId ?? null,
      reason: change.reason ?? null,
    });
    await manager.save(event);
  }
}
