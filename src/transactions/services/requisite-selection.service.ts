import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { RequisiteCandidate } from '../../bank-details/types/requisite-candidate';
import { RequisiteCandidateQuery } from '../../bank-details/types/requisite-candidate-query';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
import { CounterpartiesService } from '../../counterparties/services/counterparties.service';
import { CounterpartyBindingType } from '../../counterparties/types/counterparty-binding-type.enum';
import { bindingTypeAllows } from '../../counterparties/utils/binding-type-allows';
import { MerchantAttachmentsService } from '../../merchants/services/merchant-attachments.service';
import { MerchantTraderAdmission } from '../../merchants/types/merchant-trader-admission';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { SelectionAttempt } from '../entities/selection-attempt.entity';
import { CandidateRejectedError } from '../exceptions/candidate-rejected.exception';
import { NoRequisiteFoundError } from '../exceptions/no-requisite-found.exception';
import { IssuedSelection } from '../types/issued-selection';
import { RateScope } from '../types/rate-scope.enum';
import { RequisiteMatch } from '../types/requisite-match';
import { RequisiteRanking } from '../types/requisite-ranking';
import { SelectionCandidate } from '../types/selection-candidate';
import { SelectionFilter } from '../types/selection-filter.enum';
import { SelectionOutcome } from '../types/selection-outcome.enum';
import { SelectionRequest } from '../types/selection-request';
import { SelectionSummary } from '../types/selection-summary';
import { SkippedCandidate } from '../types/skipped-candidate';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionMethod } from '../types/transaction-method';
import { computeDeal } from '../utils/compute-deal';
import { findTransactionMethod } from '../utils/find-transaction-method';
import { limitBreach } from '../utils/limit-breach';
import { requisiteBreach } from '../utils/requisite-breach';
import { BankDetailsTurnoverService } from './bank-details-turnover.service';
import { NightStopService } from './night-stop.service';
import { RateService } from './rate.service';
import { TransactionService } from './transaction.service';
import { WalletService } from './wallet.service';

const MAX_ATTEMPTS = 5;

const REQUISITES_OF_METHOD: Record<TransactionMethod, RequisiteCandidateQuery> =
  {
    card: {
      type: BankDetailsType.CardOrSbp,
      counterpartyOnly: false,
      withCard: true,
    },
    sbp: {
      type: BankDetailsType.CardOrSbp,
      counterpartyOnly: false,
      withPhone: true,
    },
    mobile_commerce: { type: BankDetailsType.Mobile, counterpartyOnly: false },
    counterparty: { counterpartyOnly: true },
  };

type Tally = Partial<Record<SelectionFilter, number>>;

const count = (tally: Tally, reason: SelectionFilter): void => {
  tally[reason] = (tally[reason] ?? 0) + 1;
};

@Injectable()
export class RequisiteSelectionService {
  private readonly logger = new Logger(RequisiteSelectionService.name);

  constructor(
    @InjectRepository(SelectionAttempt)
    private readonly attempts: Repository<SelectionAttempt>,
    private readonly bankDetails: BankDetailsService,
    private readonly attachments: MerchantAttachmentsService,
    private readonly counterparties: CounterpartiesService,
    private readonly directory: UserDirectoryService,
    private readonly traderSettings: TraderSettingsService,
    private readonly nightStop: NightStopService,
    private readonly wallets: WalletService,
    private readonly rates: RateService,
    private readonly turnover: BankDetailsTurnoverService,
    private readonly transactions: TransactionService,
    private readonly ranking: RequisiteRanking,
  ) {}

  async issue(
    request: SelectionRequest,
    now: Date = new Date(),
  ): Promise<IssuedSelection> {
    const method = findTransactionMethod(request.method);

    if (!method?.directions.includes(TransactionKind.PayIn)) {
      throw new BadRequestException(
        `Method ${request.method} does not work for ${TransactionKind.PayIn}`,
      );
    }

    const match: RequisiteMatch = {
      currency: method.currency,
      amountFiat: request.amountFiat,
      requestedBankId: request.requestedBankId ?? null,
      requestedOperatorId: request.requestedOperatorId ?? null,
      payerBankId: request.payerBankId ?? null,
    };
    const isCounterpartyMethod = request.method === 'counterparty';
    const [requisites, admission, counterparty] = await Promise.all([
      this.bankDetails.findCandidates(
        REQUISITES_OF_METHOD[request.method],
        now,
      ),
      this.attachments.admissionOf(request.merchantId, request.method),
      isCounterpartyMethod && request.counterpartyId
        ? this.counterparties.findById(request.counterpartyId)
        : Promise.resolve(null),
    ]);
    const dropped: Tally = {};
    const boundId = counterparty?.bankDetailsId ?? null;
    const boundOwner =
      requisites.find((requisite) => requisite.id === boundId)?.userId ?? null;

    const admitted = requisites.filter((requisite) => {
      const reason =
        requisiteBreach(requisite, match) ??
        this.reserveBreach(requisite, boundId, boundOwner) ??
        this.admissionBreach(requisite, admission);

      if (reason) count(dropped, reason);

      return !reason;
    });

    const priced = await this.priceTraders(admitted, request, dropped, now);
    const usage = await this.turnover.issueUsageOf(
      priced.map(({ requisite }) => requisite.id),
      request.amountFiat,
      now,
    );
    const standing = priced.filter((candidate) => {
      const used = usage.get(candidate.bankDetailsId);
      const reason = limitBreach(
        candidate.requisite,
        used,
        request.amountFiat,
        now,
      );

      candidate.lastDealAt = used.lastDealAt;
      candidate.attached = admission.attachedTraderIds.has(
        candidate.traderUserId,
      );
      if (reason) count(dropped, reason);

      return !reason;
    });

    const ordered = await this.order(
      standing,
      isCounterpartyMethod ? counterparty : null,
      dropped,
    );
    const issued = await this.issueTo(
      ordered.slice(0, MAX_ATTEMPTS),
      request,
      match,
    );
    const skippedUnderLock: Tally = {};

    issued.skipped.forEach(({ reason }) => count(skippedUnderLock, reason));

    const summary: SelectionSummary = {
      considered: requisites.length,
      dropped,
      attempted: issued.skipped.length + (issued.candidate ? 1 : 0),
      skippedUnderLock,
      issuedBankDetailsId: issued.candidate?.bankDetailsId ?? null,
    };

    await this.journal(
      request,
      issued.skipped,
      issued.candidate,
      issued.transaction?.id ?? null,
    );

    if (!issued.transaction) throw new NoRequisiteFoundError(summary);

    return {
      transaction: issued.transaction,
      viaBinding: issued.candidate.viaBinding,
      boundNow: issued.candidate.bindsCounterparty,
      summary,
    };
  }

  private reserveBreach(
    requisite: RequisiteCandidate,
    boundId: string | null,
    boundOwner: string | null,
  ): SelectionFilter | null {
    if (!requisite.reserve || requisite.id === boundId) return null;

    return boundOwner !== null && requisite.userId === boundOwner
      ? null
      : SelectionFilter.ReserveOnly;
  }

  private admissionBreach(
    requisite: RequisiteCandidate,
    admission: MerchantTraderAdmission,
  ): SelectionFilter | null {
    if (admission.attachedTraderIds.has(requisite.userId)) return null;
    if (admission.switchedOffTraderIds.has(requisite.userId)) {
      return SelectionFilter.MerchantNotAdmitted;
    }

    return admission.exclusiveTopUp
      ? SelectionFilter.MerchantNotAdmitted
      : null;
  }

  private async priceTraders(
    requisites: RequisiteCandidate[],
    request: SelectionRequest,
    dropped: Tally,
    now: Date,
  ): Promise<SelectionCandidate[]> {
    const traderIds = [...new Set(requisites.map((r) => r.userId))];
    const [users, settings, nightStopped, wallets] = await Promise.all([
      this.directory.findByIds(traderIds),
      this.traderSettings.findByUserIds(traderIds),
      this.nightStop.nightStoppedAmong(traderIds, now),
      this.wallets.findByUserIds(traderIds),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const settingsById = new Map(settings.map((row) => [row.userId, row]));
    const walletById = new Map(
      wallets.map((wallet) => [wallet.userId, wallet]),
    );

    const eligible = requisites.filter((requisite) => {
      const trader = requisite.userId;
      const traderSettings = settingsById.get(trader);
      const wallet = walletById.get(trader);
      let reason: SelectionFilter | null = null;

      if (userById.get(trader)?.status !== UserStatus.Active) {
        reason = SelectionFilter.TraderNotActive;
      } else if (!traderSettings?.tradingEnabled) {
        reason = SelectionFilter.TradingDisabled;
      } else if (nightStopped.has(trader)) {
        reason = SelectionFilter.NightStop;
      } else if (
        !wallet ||
        wallet.insurancePayInBalance.lt(
          this.traderSettings.insurancePayInMinOf(traderSettings),
        )
      ) {
        reason = SelectionFilter.InsuranceBelowMinimum;
      } else if (!this.wallets.hasTradingBalance(wallet)) {
        reason = SelectionFilter.BalanceBelowThreshold;
      }

      if (reason) count(dropped, reason);

      return !reason;
    });

    const percents = await this.rates.resolveSubjectPercents(
      {
        scope: RateScope.Trader,
        method: request.method,
        amount: request.amountFiat,
        direction: 'payIn',
      },
      eligible.map((requisite) => ({
        userId: requisite.userId,
        individualEnabled: Boolean(
          settingsById.get(requisite.userId)?.individualRatesEnabled,
        ),
        bankId: requisite.bankId,
      })),
    );

    return eligible.flatMap((requisite, index): SelectionCandidate[] => {
      const traderPercent = percents[index];

      if (traderPercent === null) {
        count(dropped, SelectionFilter.TraderRateMissing);
        return [];
      }

      const { traderAmount } = computeDeal({
        kind: TransactionKind.PayIn,
        amountFiat: request.amountFiat,
        rate: request.rate,
        merchantPercent: request.merchantPercent,
        traderPercent,
        platformMinPercent: 0,
        leads: [],
      });
      const wallet = walletById.get(requisite.userId);

      if (this.wallets.getAvailableMain(wallet).lt(traderAmount)) {
        count(dropped, SelectionFilter.InsufficientBalance);
        return [];
      }

      return [
        {
          requisite,
          traderUserId: requisite.userId,
          bankDetailsId: requisite.id,
          bankId: requisite.bankId,
          traderPercent,
          attached: false,
          lastDealAt: null,
          viaBinding: false,
          bindsCounterparty: false,
        },
      ];
    });
  }

  private async order(
    standing: SelectionCandidate[],
    counterparty: Counterparty | null,
    dropped: Tally,
  ): Promise<SelectionCandidate[]> {
    if (!counterparty) return this.ranking.rank(standing);

    const boundId = counterparty.bankDetailsId;
    const bound = standing.filter(
      (candidate) => candidate.bankDetailsId === boundId,
    );
    const reserves = standing.filter(
      (candidate) =>
        candidate.bankDetailsId !== boundId && candidate.requisite.reserve,
    );
    const general = await this.withFreeSlots(
      standing.filter(
        (candidate) =>
          candidate.bankDetailsId !== boundId && !candidate.requisite.reserve,
      ),
      boundId === null,
      dropped,
    );

    bound.forEach((candidate) => (candidate.viaBinding = true));

    return [
      ...bound,
      ...this.ranking.rank(reserves),
      ...this.ranking.rank(general),
    ];
  }

  private async withFreeSlots(
    candidates: SelectionCandidate[],
    binds: boolean,
    dropped: Tally,
  ): Promise<SelectionCandidate[]> {
    if (!binds) return candidates;

    const bindable = candidates.filter((candidate) => {
      const allowed = bindingTypeAllows(
        CounterpartyBindingType.CardsOrSbp,
        candidate.requisite,
      );

      if (!allowed) count(dropped, SelectionFilter.RequisiteNotBindable);

      return allowed;
    });
    const bound = await this.counterparties.countBoundByRequisites(
      bindable.map((candidate) => candidate.bankDetailsId),
    );

    return bindable.filter((candidate) => {
      const max = candidate.requisite.maxCounterparties;
      const free =
        max === null || (bound.get(candidate.bankDetailsId) ?? 0) < max;

      if (!free) count(dropped, SelectionFilter.CounterpartySlotsFull);
      candidate.bindsCounterparty = free;

      return free;
    });
  }

  private issueTo(
    candidates: SelectionCandidate[],
    request: SelectionRequest,
    match: RequisiteMatch,
  ) {
    let locked: RequisiteCandidate | null = null;

    return this.transactions.createIssuedDeal(
      {
        kind: TransactionKind.PayIn,
        method: request.method,
        merchantId: request.merchantId,
        counterpartyId: request.counterpartyId ?? null,
        amountFiat: request.amountFiat,
        rate: request.rate,
        merchantPercent: request.merchantPercent,
        comment: request.comment ?? null,
        merchantTransactionId: request.merchantTransactionId ?? null,
        payerInfo: request.payerInfo ?? null,
        requestedBankId: request.requestedBankId ?? null,
        requestedOperatorId: request.requestedOperatorId ?? null,
        payerBankId: request.payerBankId ?? null,
        callbackUrl: request.callbackUrl ?? null,
        successUrl: request.successUrl ?? null,
        errorUrl: request.errorUrl ?? null,
        requestedAmountFiat: request.requestedAmountFiat ?? null,
      },
      candidates,
      {
        checkWithin: async (manager, candidate) => {
          const now = new Date();

          locked = await this.bankDetails.lockCandidateWithin(
            manager,
            candidate.bankDetailsId,
            now,
          );
          if (!locked) {
            throw new CandidateRejectedError(
              SelectionFilter.RequisiteUnavailable,
            );
          }

          const usage = await this.turnover.issueUsageOf(
            [locked.id],
            request.amountFiat,
            now,
            manager,
          );
          const reason =
            requisiteBreach(locked, match) ??
            limitBreach(locked, usage.get(locked.id), request.amountFiat, now);

          if (reason) throw new CandidateRejectedError(reason);
        },
        afterInsertWithin: async (manager, candidate) => {
          if (!candidate.bindsCounterparty) return;

          await this.bindWithin(manager, request.counterpartyId, locked);
        },
      },
    );
  }

  private async bindWithin(
    manager: EntityManager,
    counterpartyId: number,
    requisite: RequisiteCandidate,
  ): Promise<void> {
    try {
      await this.counterparties.bindWithin(
        manager,
        counterpartyId,
        requisite,
        CounterpartyBindingType.CardsOrSbp,
        null,
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new CandidateRejectedError(SelectionFilter.CounterpartySlotsFull);
      }
      throw error;
    }
  }

  private async journal(
    request: SelectionRequest,
    skipped: SkippedCandidate<SelectionCandidate>[],
    issued: SelectionCandidate | null,
    transactionId: string | null,
  ): Promise<void> {
    const rows = [
      ...skipped.map(({ candidate, reason }) => ({
        candidate,
        outcome: SelectionOutcome.Skipped,
        reason,
        transactionId: null,
      })),
      ...(issued
        ? [
            {
              candidate: issued,
              outcome: SelectionOutcome.Issued,
              reason: null,
              transactionId,
            },
          ]
        : []),
    ];

    if (rows.length === 0) return;

    try {
      await this.attempts.save(
        rows.map((row) =>
          this.attempts.create({
            requestId: request.requestId,
            transactionId: row.transactionId,
            traderUserId: row.candidate.traderUserId,
            bankDetailsId: row.candidate.bankDetailsId,
            outcome: row.outcome,
            reason: row.reason,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Selection attempts were not journaled: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
