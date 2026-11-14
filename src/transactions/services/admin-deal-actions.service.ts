import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Crypto } from '../../common/types/crypto';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { roundCrypto } from '../../common/utils/round-crypto';
import { roundFiat } from '../../common/utils/round-fiat';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { CounterpartyStatsService } from '../../counterparties/services/counterparty-stats.service';
import { MerchantCallback } from '../../merchant-callbacks/entities/merchant-callback.entity';
import { MerchantCallbacksService } from '../../merchant-callbacks/services/merchant-callbacks.service';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { MerchantCallbackEvent } from '../../merchant-callbacks/types/merchant-callback-event.enum';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { Transaction } from '../entities/transaction.entity';
import { AdminAmountChange } from '../types/admin-amount-change';
import { AdminDealActor } from '../types/admin-deal-actor';
import { AdminDealCorrection } from '../types/admin-deal-correction';
import { DisputeStatus } from '../types/dispute-status.enum';
import { MoneyMove } from '../types/money-move';
import { OverdraftParty } from '../types/overdraft-party.enum';
import { OverdraftShortfall } from '../types/overdraft-shortfall';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { countsTowardCounterpartyStats } from '../utils/counts-toward-counterparty-stats';
import { overdraftNotConfirmed } from '../utils/overdraft-not-confirmed';
import { recomputeChangedDeal } from '../utils/recompute-changed-deal';
import { DealCallbacksService } from './deal-callbacks.service';
import { MerchantBalanceService } from './merchant-balance.service';
import { TransactionService } from './transaction.service';
import { WalletService } from './wallet.service';

const SETTLED: readonly TransactionStatus[] = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];
const CLOSABLE: readonly TransactionStatus[] = [
  TransactionStatus.Active,
  TransactionStatus.Checking,
  TransactionStatus.CheckingManually,
];
const PAYOUT_CANCELABLE: readonly TransactionStatus[] = [
  TransactionStatus.Pending,
  TransactionStatus.Active,
];
const LIVE_DISPUTES = [
  DisputeStatus.Open,
  DisputeStatus.Reviewing,
  DisputeStatus.Deferred,
];

const NOTHING = toCrypto(0);
const CALLBACK_INTERVAL_MS = 60_000;

const refusal = (code: string, message: string) =>
  new ConflictException({ statusCode: 409, code, message });

@Injectable()
export class AdminDealActionsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly transactions: TransactionService,
    private readonly wallets: WalletService,
    private readonly merchantBalances: MerchantBalanceService,
    private readonly counterpartyStats: CounterpartyStatsService,
    private readonly dealCallbacks: DealCallbacksService,
    private readonly audit: AuditService,
    private readonly callbacks: MerchantCallbacksService,
    private readonly merchantSettings: MerchantSettingsService,
  ) {}

  close(actor: AdminDealActor, id: string): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, id);

      if (
        deal.kind !== TransactionKind.PayIn ||
        !CLOSABLE.includes(deal.status)
      ) {
        throw refusal('DEAL_NOT_CLOSABLE', 'Only an open pay-in can be closed');
      }

      await this.assertNoLiveDispute(manager, id, [
        DisputeStatus.Open,
        DisputeStatus.Reviewing,
      ]);

      const fromStatus = deal.status;
      const closed = await this.transactions.transitionLocked(manager, deal, {
        toStatus: TransactionStatus.Success,
        source: StatusEventSource.Admin,
        actorUserId: actor.userId,
      });

      await this.record(manager, actor, deal, 'admin.deal_closed', {
        transactionId: id,
        fromStatus,
      });

      return closed;
    });
  }

  changeAmount(
    actor: AdminDealActor,
    id: string,
    change: AdminAmountChange,
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, id);

      if (!SETTLED.includes(deal.status)) {
        throw refusal(
          'DEAL_NOT_SETTLED',
          'Only a completed deal can change its amount',
        );
      }

      await this.assertNoLiveDispute(manager, id, LIVE_DISPUTES);

      if (change.amountFiat.eq(deal.amountFiat)) {
        throw new BadRequestException('The amount is already this');
      }

      const shares = await this.sharesOf(manager, id);
      const figures = recomputeChangedDeal(deal, shares, change.amountFiat);
      const newShare = new Map(
        figures.leadShares.map((share) => [share.shareId, share.amount]),
      );
      const sign = deal.kind === TransactionKind.PayIn ? -1 : 1;
      const moves: MoneyMove[] = [
        {
          party: OverdraftParty.Trader,
          id: deal.traderUserId,
          delta: this.scaled(
            figures.traderAmount.minus(deal.traderAmount),
            sign,
          ),
        },
        ...shares.map((share) => ({
          party: OverdraftParty.Lead,
          id: share.leadUserId,
          delta: roundCrypto(
            (newShare.get(share.id) ?? share.amount).minus(share.amount),
          ),
        })),
        ...this.merchantMove(
          deal,
          this.scaled(figures.merchantAmount.minus(deal.merchantAmount), -sign),
        ),
      ];

      await this.applyMoves(manager, deal, moves, actor, change);

      const amountFiatBefore = deal.amountFiat;
      const fromStatus = deal.status;

      Object.assign(deal, {
        originalAmountFiat: deal.originalAmountFiat ?? deal.amountFiat,
        originalAmountCrypto: deal.originalAmountCrypto ?? deal.amountCrypto,
        originalMerchantCommission:
          deal.originalMerchantCommission ?? deal.merchantCommission,
        originalTraderCommission:
          deal.originalTraderCommission ?? deal.traderCommission,
        originalLeadCommission:
          deal.originalLeadCommission ?? deal.leadCommission,
        originalTraderAmount: deal.originalTraderAmount ?? deal.traderAmount,
        originalMerchantAmount:
          deal.originalMerchantAmount ?? deal.merchantAmount,
        amountFiat: change.amountFiat,
        amountCrypto: figures.amountCrypto,
        merchantCommission: figures.merchantCommission,
        traderCommission: figures.traderCommission,
        leadCommission: figures.leadCommission,
        traderAmount: figures.traderAmount,
        merchantAmount: figures.merchantAmount,
        status: TransactionStatus.SuccessChanged,
      });
      for (const share of shares) {
        share.amount = newShare.get(share.id) ?? share.amount;
      }
      await manager.save(shares);
      await manager.save(deal);

      if (countsTowardCounterpartyStats(deal)) {
        await this.counterpartyStats.recordDisputePaidWithin(
          manager,
          deal.counterpartyId,
          {
            newlyPaid: false,
            amountFiat: roundFiat(change.amountFiat.minus(amountFiatBefore)),
            resolvedAt: deal.resolvedAt ?? new Date(),
            traderUserId: deal.traderUserId,
          },
        );
      }

      await this.finish(manager, deal, fromStatus, actor, change.reason);
      await this.record(manager, actor, deal, 'admin.deal_amount_changed', {
        transactionId: id,
        amountFiatBefore: formatFiat(amountFiatBefore),
        amountFiat: formatFiat(change.amountFiat),
        reason: change.reason,
        confirmOverdraft: change.confirmOverdraft,
      });

      return deal;
    });
  }

  cancelSettled(
    actor: AdminDealActor,
    id: string,
    correction: AdminDealCorrection,
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, id);

      if (!SETTLED.includes(deal.status)) {
        throw refusal(
          'DEAL_NOT_SETTLED',
          'Only a completed deal can be canceled this way',
        );
      }

      await this.assertNoLiveDispute(manager, id, LIVE_DISPUTES);

      const shares = await this.sharesOf(manager, id);
      const paidIn = deal.kind === TransactionKind.PayIn;
      const moves: MoneyMove[] = [
        {
          party: OverdraftParty.Trader,
          id: deal.traderUserId,
          delta: paidIn ? deal.traderAmount : this.negated(deal.traderAmount),
        },
        ...shares.map((share) => ({
          party: OverdraftParty.Lead,
          id: share.leadUserId,
          delta: this.negated(share.amount),
        })),
        ...this.merchantMove(
          deal,
          paidIn ? this.negated(deal.merchantAmount) : deal.merchantAmount,
        ),
      ];

      await this.applyMoves(manager, deal, moves, actor, correction);

      const fromStatus = deal.status;

      deal.status = TransactionStatus.Canceled;
      deal.resolvedAt = new Date();
      await manager.save(deal);
      await this.finish(manager, deal, fromStatus, actor, correction.reason);
      await this.record(manager, actor, deal, 'admin.deal_settled_canceled', {
        transactionId: id,
        fromStatus,
        reason: correction.reason,
        confirmOverdraft: correction.confirmOverdraft,
      });

      return deal;
    });
  }

  restore(
    actor: AdminDealActor,
    id: string,
    correction: AdminDealCorrection,
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, id);

      if (
        deal.kind !== TransactionKind.PayIn ||
        deal.status !== TransactionStatus.Canceled
      ) {
        throw refusal(
          'DEAL_NOT_RESTORABLE',
          'Only a canceled pay-in can be restored',
        );
      }

      await this.assertNoLiveDispute(manager, id, LIVE_DISPUTES);

      const shares = await this.sharesOf(manager, id);
      const paidBefore = await manager.exists(TransactionStatusEvent, {
        where: {
          transactionId: id,
          toStatus: In(SETTLED as TransactionStatus[]),
        },
      });
      const moves: MoneyMove[] = [
        {
          party: OverdraftParty.Trader,
          id: deal.traderUserId,
          delta: this.negated(deal.traderAmount),
        },
        ...shares.map((share) => ({
          party: OverdraftParty.Lead,
          id: share.leadUserId,
          delta: share.amount,
        })),
        ...this.merchantMove(deal, deal.merchantAmount),
      ];

      await this.applyMoves(manager, deal, moves, actor, correction);

      const fromStatus = deal.status;

      deal.status = deal.originalAmountFiat
        ? TransactionStatus.SuccessChanged
        : TransactionStatus.Success;
      deal.resolvedAt = new Date();
      await manager.save(deal);

      if (countsTowardCounterpartyStats(deal)) {
        await this.counterpartyStats.recordDisputePaidWithin(
          manager,
          deal.counterpartyId,
          {
            newlyPaid: !paidBefore,
            amountFiat: paidBefore ? toFiat(0) : deal.amountFiat,
            resolvedAt: deal.resolvedAt,
            traderUserId: deal.traderUserId,
          },
        );
      }

      await this.finish(manager, deal, fromStatus, actor, correction.reason);
      await this.record(manager, actor, deal, 'admin.deal_restored', {
        transactionId: id,
        reason: correction.reason,
        confirmOverdraft: correction.confirmOverdraft,
      });

      return deal;
    });
  }

  cancelPayout(
    actor: AdminDealActor,
    id: string,
    reason: string | null,
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, id);

      if (
        deal.kind !== TransactionKind.PayOut ||
        !PAYOUT_CANCELABLE.includes(deal.status)
      ) {
        throw refusal(
          'PAYOUT_NOT_CANCELABLE',
          'Only a pending or taken pay-out can be canceled',
        );
      }

      await this.assertNoLiveDispute(manager, id, LIVE_DISPUTES);

      const fromStatus = deal.status;
      const canceled = await this.transactions.transitionLocked(manager, deal, {
        toStatus: TransactionStatus.Canceled,
        source: StatusEventSource.Admin,
        actorUserId: actor.userId,
        reason,
      });

      await this.record(manager, actor, deal, 'admin.payout_canceled', {
        transactionId: id,
        fromStatus,
        reason,
      });

      return canceled;
    });
  }

  sendCallback(
    actor: AdminDealActor,
    id: string,
    now: Date = new Date(),
  ): Promise<MerchantCallback> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, id);

      if (!(await this.callbackUrlOf(manager, deal))) {
        throw refusal(
          'NO_CALLBACK_URL',
          'This deal has no callback address to send to',
        );
      }

      const state = await this.callbacks.deliveryStateWithin(
        manager,
        id,
        new Date(now.getTime() - CALLBACK_INTERVAL_MS),
      );

      if (state.queued) {
        throw refusal(
          'CALLBACK_QUEUED',
          'A callback of this deal is still waiting to be delivered',
        );
      }

      if (state.recent) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'A callback of this deal was sent less than a minute ago',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const callback = (await this.dealCallbacks.recordWithin(
        manager,
        deal,
        MerchantCallbackEvent.StatusChanged,
      )) as MerchantCallback;

      await this.record(manager, actor, deal, 'admin.callback_sent', {
        transactionId: id,
        callbackId: callback.id,
        status: deal.status,
      });

      return callback;
    });
  }

  async hasCallbackUrl(deal: Transaction): Promise<boolean> {
    return Boolean(await this.callbackUrlOf(this.dataSource.manager, deal));
  }

  private async callbackUrlOf(
    manager: EntityManager,
    deal: Transaction,
  ): Promise<string | null> {
    if (!deal.merchantId || !deal.merchantTransactionId) return null;

    return (
      deal.callbackUrl ??
      (await this.merchantSettings.callbackUrlWithin(manager, deal.merchantId))
    );
  }

  private async lockDeal(
    manager: EntityManager,
    id: string,
  ): Promise<Transaction> {
    const deal = await manager.findOne(Transaction, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!deal) throw new NotFoundException('Transaction not found');

    return deal;
  }

  private async assertNoLiveDispute(
    manager: EntityManager,
    transactionId: string,
    statuses: DisputeStatus[],
  ): Promise<void> {
    if (
      await manager.exists(TransactionDispute, {
        where: { transactionId, status: In(statuses) },
      })
    ) {
      throw refusal(
        'DEAL_UNDER_DISPUTE',
        'This deal has a live dispute; decide it through /admin/disputes',
      );
    }
  }

  private sharesOf(
    manager: EntityManager,
    transactionId: string,
  ): Promise<TransactionLeadShare[]> {
    return manager.find(TransactionLeadShare, {
      where: { transactionId },
      order: { id: 'ASC' },
    });
  }

  private merchantMove(deal: Transaction, delta: Crypto): MoneyMove[] {
    return deal.merchantId
      ? [{ party: OverdraftParty.Merchant, id: deal.merchantId, delta }]
      : [];
  }

  private scaled(value: Decimal, sign: number): Crypto {
    return roundCrypto(sign < 0 ? value.neg() : value);
  }

  private negated(value: Crypto): Crypto {
    return roundCrypto(value.neg());
  }

  private async applyMoves(
    manager: EntityManager,
    deal: Transaction,
    moves: readonly MoneyMove[],
    actor: AdminDealActor,
    correction: AdminDealCorrection,
  ): Promise<void> {
    const walletMoves = moves.filter(
      (move) => move.party !== OverdraftParty.Merchant && !move.delta.isZero(),
    );
    const leadIds = walletMoves
      .filter((move) => move.party === OverdraftParty.Lead)
      .map((move) => move.id);
    const wallets = await this.wallets.lockWalletsWithin(
      manager,
      walletMoves.map((move) => move.id),
      leadIds,
    );
    const runningMain = new Map<string, Crypto>(
      wallets.map((wallet) => [
        wallet.userId,
        this.wallets.getAvailableMain(wallet),
      ]),
    );
    const merchantMove = moves.find(
      (move) => move.party === OverdraftParty.Merchant && !move.delta.isZero(),
    );
    const merchantBalance = merchantMove
      ? (
          await this.merchantBalances.lockBalanceWithin(
            manager,
            merchantMove.id,
          )
        ).balance
      : null;
    const shortfalls: OverdraftShortfall[] = [];

    for (const move of walletMoves) {
      const after = roundCrypto(
        (runningMain.get(move.id) ?? NOTHING).plus(move.delta),
      );

      runningMain.set(move.id, after);
      if (move.delta.lt(0) && after.lt(0)) {
        shortfalls.push({
          party: move.party,
          id: move.id,
          shortfall: this.negated(after),
        });
      }
    }

    if (merchantMove && merchantBalance) {
      const after = roundCrypto(merchantBalance.plus(merchantMove.delta));

      if (merchantMove.delta.lt(0) && after.lt(0)) {
        shortfalls.push({
          party: OverdraftParty.Merchant,
          id: merchantMove.id,
          shortfall: this.negated(after),
        });
      }
    }

    if (shortfalls.length && !correction.confirmOverdraft) {
      throw overdraftNotConfirmed(shortfalls);
    }

    for (const move of walletMoves) {
      await this.wallets.adjustMainWithin(
        manager,
        move.id,
        move.delta,
        deal.id,
      );
    }

    if (merchantMove) {
      const credited =
        deal.kind === TransactionKind.PayIn && merchantMove.delta.gt(0)
          ? await this.merchantBalances.creditDealWithin(
              manager,
              merchantMove.id,
              merchantMove.delta,
              deal.id,
            )
          : null;

      if (!credited) {
        await this.merchantBalances.correctDealWithin(
          manager,
          merchantMove.id,
          merchantMove.delta,
          deal.id,
          actor.userId,
        );
      }
    }
  }

  private async finish(
    manager: EntityManager,
    deal: Transaction,
    fromStatus: TransactionStatus,
    actor: AdminDealActor,
    reason: string,
  ): Promise<void> {
    await this.transactions.recordEventWithin(manager, deal.id, fromStatus, {
      toStatus: deal.status,
      source: StatusEventSource.Admin,
      actorUserId: actor.userId,
      reason,
    });
    await this.dealCallbacks.recordWithin(
      manager,
      deal,
      MerchantCallbackEvent.StatusChanged,
    );
  }

  private record(
    manager: EntityManager,
    actor: AdminDealActor,
    deal: Transaction,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<unknown> {
    return this.audit.record(
      {
        actorUserId: actor.userId,
        targetUserId: deal.traderUserId ?? null,
        action,
        metadata: {
          ...metadata,
          kind: deal.kind,
          amountCrypto: formatCrypto(deal.amountCrypto),
        },
      },
      manager,
    );
  }
}
