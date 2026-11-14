import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Page, toPage } from '../../common/types/page';
import { FIAT_SCALE } from '../../common/utils/fiat-scale';
import { RATE_SCALE } from '../../common/utils/rate-scale';
import { sortDirection } from '../../common/utils/sort-direction';
import { CounterpartyStatsService } from '../../counterparties/services/counterparty-stats.service';
import { MerchantCallbackEvent } from '../../merchant-callbacks/types/merchant-callback-event.enum';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { UserTeamService } from '../../users/services/user-team.service';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { CandidateRejectedError } from '../exceptions/candidate-rejected.exception';
import { CreateDealInput } from '../types/create-deal-input';
import { DealCandidate } from '../types/deal-candidate';
import { DisputeStatus } from '../types/dispute-status.enum';
import { DealIssueHooks } from '../types/deal-issue-hooks';
import { IssuedDeal } from '../types/issued-deal';
import { IssuedDealInput } from '../types/issued-deal-input';
import { PayOutRequestInput } from '../types/pay-out-request-input';
import { PreparedDeal } from '../types/prepared-deal';
import { SameRequestQuery } from '../types/same-request-query';
import { SelectionFilter } from '../types/selection-filter.enum';
import { SkippedCandidate } from '../types/skipped-candidate';
import { StatusChange } from '../types/status-change';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionListQuery } from '../types/transaction-list-query';
import { TransactionTextMatch } from '../types/transaction-text-match';
import { TransactionMethodDefinition } from '../types/transaction-method-definition';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { DealComputation } from '../types/deal-computation';
import {
  computeDeal,
  PlatformMinimumUnreachableError,
} from '../utils/compute-deal';
import { appealDeadline } from '../utils/appeal-deadline';
import { MERCHANT_CANCELED_REASON } from '../utils/merchant-canceled-reason';
import { computePayOutRequest } from '../utils/compute-pay-out-request';
import { countsTowardCounterpartyStats } from '../utils/counts-toward-counterparty-stats';
import { findTransactionMethod } from '../utils/find-transaction-method';
import {
  canTransition,
  expiryTarget,
  isFinalStatus,
  startStatus,
} from '../utils/status-transitions';
import { transactionListOrder } from '../utils/transaction-list-order';
import { transactionListWhereAny } from '../utils/transaction-list-where-any';
import { RateService } from './rate.service';
import { DealCallbacksService } from './deal-callbacks.service';
import { MerchantBalanceService } from './merchant-balance.service';
import { WalletService } from './wallet.service';

const MINUTE_MS = 60_000;
const PAYMENT_PAGE_TOKEN_BYTES = 32;
const FAILED_DEAL_STATUSES: readonly TransactionStatus[] = [
  TransactionStatus.Active,
  TransactionStatus.Checking,
  TransactionStatus.CheckingManually,
  TransactionStatus.Canceled,
];
const DEFERRED_DEAL_SUCCEEDED = 'deal_succeeded';
const DEFERRED_DEAL_CANCELED = 'deal_canceled';
const DEFERRED_STARTED = 'deferred_dispute_started';
const DEFERRED_STARTING_SOURCES: readonly StatusEventSource[] = [
  StatusEventSource.AutoTimer,
  StatusEventSource.Trader,
];
const MERCHANT_CANCELABLE_STATUS: Record<TransactionKind, TransactionStatus> = {
  [TransactionKind.PayIn]: TransactionStatus.Active,
  [TransactionKind.PayOut]: TransactionStatus.Pending,
};
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
    private readonly counterpartyStats: CounterpartyStatsService,
    private readonly dealCallbacks: DealCallbacksService,
  ) {}

  findById(id: string): Promise<Transaction | null> {
    return this.transactions.findOne({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<Transaction[]> {
    if (!ids.length) return [];

    return this.transactions.find({ where: { id: In(ids) } });
  }

  findTraderWindow(userId: string, since: Date): Promise<Transaction[]> {
    return this.transactions.find({
      where: { traderUserId: userId, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'ASC' },
    });
  }

  findByMerchantTransactionId(
    merchantId: string,
    merchantTransactionId: string,
  ): Promise<Transaction | null> {
    return this.transactions.findOne({
      where: { merchantId, merchantTransactionId },
    });
  }

  findActiveSameRequest(
    request: SameRequestQuery,
  ): Promise<Transaction | null> {
    return this.transactions.findOne({
      where: {
        kind: TransactionKind.PayIn,
        status: TransactionStatus.Active,
        merchantId: request.merchantId,
        counterpartyId: request.counterpartyId,
        method: request.method,
        requestedAmountFiat: request.requestedAmountFiat,
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  countFailedPayInsSince(
    merchantId: string,
    counterpartyId: number,
    since: Date,
  ): Promise<number> {
    return this.transactions.count({
      where: {
        kind: TransactionKind.PayIn,
        merchantId,
        counterpartyId,
        status: In(FAILED_DEAL_STATUSES),
        createdAt: MoreThanOrEqual(since),
      },
    });
  }

  async list(
    query: TransactionListQuery & TransactionTextMatch,
  ): Promise<Page<Transaction>> {
    if (query.bankDetailsIds?.length === 0) return toPage([[], 0], query);

    const where = transactionListWhereAny(query);
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

  async countsByMethod(
    query: Omit<
      TransactionListQuery,
      'page' | 'limit' | 'sortBy' | 'sortOrder'
    > &
      TransactionTextMatch,
  ): Promise<Map<string, number>> {
    if (query.bankDetailsIds?.length === 0) return new Map();

    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select('transaction.method', 'method')
      .addSelect('COUNT(*)', 'count')
      .setFindOptions({
        where: transactionListWhereAny(query as TransactionListQuery),
      })
      .groupBy('transaction.method')
      .getRawMany<{ method: string; count: string }>();

    return new Map(rows.map((row) => [row.method, Number(row.count)]));
  }

  async listForExport(
    query: Omit<
      TransactionListQuery,
      'page' | 'limit' | 'sortBy' | 'sortOrder'
    > &
      TransactionTextMatch,
    maxRows: number,
  ): Promise<Transaction[]> {
    if (query.bankDetailsIds?.length === 0) return [];

    const rows = await this.transactions.find({
      where: transactionListWhereAny(query as TransactionListQuery),
      order: { createdAt: 'DESC', id: 'DESC' },
      take: maxRows + 1,
    });

    if (rows.length > maxRows) {
      throw new BadRequestException(
        `More than ${maxRows} deals match; narrow the period or the filters`,
      );
    }

    return rows;
  }

  private listByMerchantName(
    query: TransactionListQuery,
    where: FindOptionsWhere<Transaction>[],
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
    const prepared = await this.prepareDeal(input);

    return this.dataSource.transaction((manager) =>
      this.insertDealWithin(manager, input, prepared),
    );
  }

  async createIssuedDeal<C extends DealCandidate>(
    input: IssuedDealInput,
    candidates: readonly C[],
    hooks: DealIssueHooks<C>,
  ): Promise<IssuedDeal<C>> {
    const skipped: SkippedCandidate<C>[] = [];

    for (const candidate of candidates) {
      const dealInput: CreateDealInput = {
        ...input,
        traderUserId: candidate.traderUserId,
        bankDetailsId: candidate.bankDetailsId,
        traderPercent: candidate.traderPercent,
        bankId: candidate.bankId,
      };
      let prepared: PreparedDeal;

      try {
        prepared = await this.prepareDeal(dealInput);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        skipped.push({ candidate, reason: SelectionFilter.DealRefused });
        continue;
      }

      try {
        const transaction = await this.dataSource.transaction(
          async (manager) => {
            await hooks.checkWithin(manager, candidate);
            const inserted = await this.insertDealWithin(
              manager,
              dealInput,
              prepared,
            );
            await hooks.afterInsertWithin?.(manager, candidate, inserted);

            return inserted;
          },
        );

        return { transaction, candidate, skipped };
      } catch (error) {
        if (error instanceof CandidateRejectedError) {
          skipped.push({ candidate, reason: error.reason });
        } else if (error instanceof ConflictException) {
          skipped.push({
            candidate,
            reason: SelectionFilter.InsufficientBalance,
          });
        } else {
          throw error;
        }
      }
    }

    return { transaction: null, candidate: null, skipped };
  }

  async createPayOutRequest(input: PayOutRequestInput): Promise<Transaction> {
    this.assertDealShape({ ...input, kind: TransactionKind.PayOut });

    const pricing = computePayOutRequest(input);
    const windowMinutes =
      input.windowMinutes ?? (await this.windowMinutesOf(input.merchantId));
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + windowMinutes * MINUTE_MS);
    const status = startStatus(TransactionKind.PayOut);

    return this.dataSource.transaction(async (manager) => {
      const transaction = manager.create(Transaction, {
        kind: TransactionKind.PayOut,
        status,
        method: input.method,
        traderUserId: null,
        merchantId: input.merchantId,
        amountFiat: input.amountFiat,
        amountCrypto: pricing.amountCrypto,
        rate: input.rate,
        merchantPercent: input.merchantPercent,
        merchantCommission: pricing.merchantCommission,
        merchantAmount: pricing.merchantAmount,
        merchantTransactionId: input.merchantTransactionId,
        payerInfo: input.payerInfo,
        callbackUrl: input.callbackUrl,
        payoutOwnerName: input.payoutOwnerName,
        payoutBankId: input.payoutBankId,
        payoutCardNumber: input.payoutCardNumber,
        payoutPhone: input.payoutPhone,
        createdAt,
        expiresAt,
      });
      await manager.save(transaction);
      await this.holdPayOutWithin(manager, transaction);
      await this.writeEvent(manager, transaction.id, null, {
        toStatus: status,
        source: StatusEventSource.System,
      });

      return transaction;
    });
  }

  private assertDealShape(
    input: Pick<CreateDealInput, 'kind' | 'method' | 'amountFiat' | 'rate'>,
  ): TransactionMethodDefinition {
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

    return method;
  }

  private async windowMinutesOf(merchantId: string | null): Promise<number> {
    const merchantWindowMinutes = merchantId
      ? await this.merchantSettings.payInWindowMinutesOf(merchantId)
      : null;

    return (
      merchantWindowMinutes ??
      this.config.getOrThrow<number>('DEAL_TTL_MINUTES')
    );
  }

  private holdPayOutWithin(
    manager: EntityManager,
    transaction: Transaction,
  ): Promise<unknown> {
    return this.merchantBalances.holdPayOutWithin(
      manager,
      transaction.merchantId,
      transaction.merchantAmount,
      transaction.id,
      () =>
        this.merchantSettings.allowsOverdraftWithin(
          manager,
          transaction.merchantId,
        ),
    );
  }

  private async prepareDeal(input: CreateDealInput): Promise<PreparedDeal> {
    const method = this.assertDealShape(input);

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
    const status = startStatus(input.kind);
    const ttlMinutes = await this.windowMinutesOf(input.merchantId);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlMinutes * MINUTE_MS);

    return { computation, status, createdAt, expiresAt };
  }

  private async insertDealWithin(
    manager: EntityManager,
    input: CreateDealInput,
    { computation, status, createdAt, expiresAt }: PreparedDeal,
  ): Promise<Transaction> {
    const holdsMerchant =
      input.kind === TransactionKind.PayOut && Boolean(input.merchantId);

    if (input.kind === TransactionKind.PayIn) {
      await this.wallets.reserveMainEscrowWithin(
        manager,
        input.traderUserId,
        computation.traderAmount,
      );
    }

    if (input.traderUserId) {
      await this.wallets.stampAcceptedDealWithin(
        manager,
        input.traderUserId,
        createdAt,
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
      merchantTransactionId: input.merchantTransactionId ?? null,
      payerInfo: input.payerInfo ?? null,
      requestedBankId: input.requestedBankId ?? null,
      requestedOperatorId: input.requestedOperatorId ?? null,
      payerBankId: input.payerBankId ?? null,
      callbackUrl: input.callbackUrl ?? null,
      successUrl: input.successUrl ?? null,
      errorUrl: input.errorUrl ?? null,
      requestedAmountFiat: input.requestedAmountFiat ?? null,
      paymentPageToken:
        input.kind === TransactionKind.PayIn && input.merchantTransactionId
          ? randomBytes(PAYMENT_PAGE_TOKEN_BYTES).toString('base64url')
          : null,
      createdAt,
      expiresAt,
    });
    await manager.save(transaction);
    if (holdsMerchant) await this.holdPayOutWithin(manager, transaction);
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
    if (countsTowardCounterpartyStats(transaction)) {
      await this.counterpartyStats.recordDealCreatedWithin(
        manager,
        transaction.counterpartyId,
        {
          traderUserId: transaction.traderUserId,
          createdAt: transaction.createdAt,
        },
      );
    }
    return transaction;
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

      this.assertHandMoveKeepsTrader(transaction, change);

      if (
        await manager.exists(TransactionDispute, {
          where: {
            transactionId,
            status: In([DisputeStatus.Open, DisputeStatus.Reviewing]),
          },
        })
      ) {
        throw new ConflictException(
          'This deal is under a dispute; decide it through /admin/disputes',
        );
      }

      if (
        change.toStatus === TransactionStatus.Dispute &&
        (await manager.exists(TransactionDispute, {
          where: { transactionId, status: DisputeStatus.Deferred },
        }))
      ) {
        throw new ConflictException('This deal already has a waiting dispute');
      }

      return this.transitionLocked(manager, transaction, change);
    });
  }

  private assertHandMoveKeepsTrader(
    transaction: Transaction,
    change: StatusChange,
  ): void {
    const untaken =
      transaction.status === TransactionStatus.Pending &&
      transaction.traderUserId === null &&
      change.toStatus === TransactionStatus.Active;
    const taken =
      transaction.status === TransactionStatus.Active &&
      transaction.payoutTakenAt !== null &&
      transaction.payoutTakenAt !== undefined &&
      change.toStatus === TransactionStatus.Pending;

    if (untaken || taken) {
      throw new ConflictException(
        'A trader takes or releases a pay-out only through its own actions',
      );
    }
  }

  async cancelByMerchant(
    merchantId: string,
    transactionId: string,
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockMerchantDeal(
        manager,
        merchantId,
        transactionId,
      );

      if (deal.status === TransactionStatus.Canceled) return deal;
      if (deal.status !== MERCHANT_CANCELABLE_STATUS[deal.kind]) {
        throw new ConflictException('The deal cannot be canceled');
      }

      const fromStatus = deal.status;
      const canceled = await this.transitionLocked(manager, deal, {
        toStatus: TransactionStatus.Canceled,
        source: StatusEventSource.Merchant,
        actorUserId: null,
        reason: MERCHANT_CANCELED_REASON,
      });

      await this.audit.record(
        {
          actorUserId: null,
          action: 'merchant_api.deal_canceled',
          metadata: { merchantId, transactionId, fromStatus },
        },
        manager,
      );

      return canceled;
    });
  }

  async extendTimerByMerchant(
    merchantId: string,
    transactionId: string,
    now: Date = new Date(),
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockMerchantDeal(
        manager,
        merchantId,
        transactionId,
      );
      const expiresAt = deal.expiresAt;

      if (
        deal.kind !== TransactionKind.PayIn ||
        deal.timerExtendedAt ||
        !expiresAt ||
        expiresAt.getTime() <= now.getTime() ||
        !expiryTarget(deal.kind, deal.status)
      ) {
        throw new ConflictException('The timer cannot be extended');
      }

      deal.expiresAt = new Date(
        2 * expiresAt.getTime() - deal.createdAt.getTime(),
      );
      deal.timerExtendedAt = now;
      await manager.save(deal);

      await this.audit.record(
        {
          actorUserId: null,
          action: 'merchant_api.timer_extended',
          metadata: {
            merchantId,
            transactionId,
            status: deal.status,
            expiresAtBefore: expiresAt.toISOString(),
            expiresAt: deal.expiresAt.toISOString(),
          },
        },
        manager,
      );
      await this.dealCallbacks.recordWithin(
        manager,
        deal,
        MerchantCallbackEvent.TimerExtended,
      );

      return deal;
    });
  }

  private async lockMerchantDeal(
    manager: EntityManager,
    merchantId: string,
    transactionId: string,
  ): Promise<Transaction> {
    const deal = await manager.findOne(Transaction, {
      where: { id: transactionId, merchantId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!deal) throw new NotFoundException('Deal not found');

    return deal;
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

    if (
      !canTransition(
        transaction.kind,
        transaction.status,
        change.toStatus,
        change.source,
      )
    ) {
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
    if (countsTowardCounterpartyStats(transaction)) {
      await this.recordCounterpartyStatus(manager, transaction);
    }
    await this.dealCallbacks.recordWithin(
      manager,
      transaction,
      MerchantCallbackEvent.StatusChanged,
    );
    if (
      transaction.kind === TransactionKind.PayIn &&
      isFinalStatus(change.toStatus)
    ) {
      await this.resolveDeferredDisputeLocked(manager, transaction, change);
    }
    return transaction;
  }

  async moveForDisputeLocked(
    manager: EntityManager,
    transaction: Transaction,
    change: StatusChange,
  ): Promise<Transaction> {
    const from = transaction.status;
    const firstDispute =
      change.toStatus === TransactionStatus.Dispute &&
      !(await manager.exists(TransactionStatusEvent, {
        where: {
          transactionId: transaction.id,
          toStatus: TransactionStatus.Dispute,
        },
      }));

    transaction.status = change.toStatus;
    await manager.save(transaction);
    await this.writeEvent(manager, transaction.id, from, change);

    if (firstDispute && countsTowardCounterpartyStats(transaction)) {
      await this.recordCounterpartyStatus(manager, transaction);
    }

    await this.dealCallbacks.recordWithin(
      manager,
      transaction,
      MerchantCallbackEvent.StatusChanged,
    );

    return transaction;
  }

  private async resolveDeferredDisputeLocked(
    manager: EntityManager,
    transaction: Transaction,
    change: StatusChange,
  ): Promise<void> {
    const where = {
      transactionId: transaction.id,
      status: DisputeStatus.Deferred,
    };

    if (!(await manager.exists(TransactionDispute, { where }))) return;

    const dispute = await manager.findOneOrFail(TransactionDispute, {
      where,
      lock: { mode: 'pessimistic_write' },
    });

    const startsOnCancel =
      change.toStatus === TransactionStatus.Canceled &&
      DEFERRED_STARTING_SOURCES.includes(change.source);

    if (!startsOnCancel) {
      dispute.status = DisputeStatus.Canceled;
      dispute.declineReason =
        change.toStatus === TransactionStatus.Canceled
          ? DEFERRED_DEAL_CANCELED
          : DEFERRED_DEAL_SUCCEEDED;
      dispute.resolvedAt = new Date();
      await manager.save(dispute);
      await this.dealCallbacks.recordWithin(
        manager,
        transaction,
        MerchantCallbackEvent.DisputeChanged,
      );

      return;
    }

    const now = new Date();

    dispute.status = DisputeStatus.Open;
    dispute.statusBefore = TransactionStatus.Canceled;
    dispute.openedAt = now;
    dispute.traderDeadlineAt = this.payInAppealDeadline(now);
    await manager.save(dispute);
    await this.moveForDisputeLocked(manager, transaction, {
      toStatus: TransactionStatus.Dispute,
      source: StatusEventSource.Merchant,
      actorUserId: null,
      reason: DEFERRED_STARTED,
    });
    await this.dealCallbacks.recordWithin(
      manager,
      transaction,
      MerchantCallbackEvent.DisputeChanged,
    );
  }

  payInAppealDeadline(from: Date): Date {
    return appealDeadline(
      from,
      this.config.getOrThrow<number>('APPEAL_TRADER_RESPONSE_MINUTES'),
      {
        startHour: this.config.getOrThrow<number>('APPEAL_NIGHT_START_HOUR'),
        endHour: this.config.getOrThrow<number>('APPEAL_NIGHT_END_HOUR'),
        graceMinutes: this.config.getOrThrow<number>(
          'APPEAL_NIGHT_GRACE_MINUTES',
        ),
        timeZone: this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
      },
    );
  }

  private async recordCounterpartyStatus(
    manager: EntityManager,
    transaction: Transaction,
  ): Promise<void> {
    if (transaction.status === TransactionStatus.Dispute) {
      await this.counterpartyStats.recordDisputeWithin(
        manager,
        transaction.counterpartyId,
      );
    } else if (isFinalStatus(transaction.status)) {
      await this.counterpartyStats.recordCompletedWithin(
        manager,
        transaction.counterpartyId,
        {
          paid: transaction.status !== TransactionStatus.Canceled,
          amountFiat: transaction.amountFiat,
          resolvedAt: transaction.resolvedAt,
          traderUserId: transaction.traderUserId,
        },
      );
    }
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

  recordEventWithin(
    manager: EntityManager,
    transactionId: string,
    fromStatus: TransactionStatus | null,
    change: StatusChange,
  ): Promise<void> {
    return this.writeEvent(manager, transactionId, fromStatus, change);
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
