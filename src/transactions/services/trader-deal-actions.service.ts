import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { Crypto } from '../../common/types/crypto';
import { Fiat } from '../../common/types/fiat';
import { formatFiat } from '../../common/utils/format-fiat';
import { roundCrypto } from '../../common/utils/round-crypto';
import { DeviceConfirmation } from '../types/device-confirmation';
import { DeviceConfirmationRequest } from '../types/device-confirmation-request';
import { DeviceMatchOutcome } from '../types/device-match-outcome.enum';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { Transaction } from '../entities/transaction.entity';
import { PayInDeclineReason } from '../types/pay-in-decline-reason.enum';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TraderDealActor } from '../types/trader-deal-actor';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { recomputeChangedDeal } from '../utils/recompute-changed-deal';
import { TransactionService } from './transaction.service';
import { WalletService } from './wallet.service';

const CONFIRMABLE_STATUSES: readonly TransactionStatus[] = [
  TransactionStatus.Active,
  TransactionStatus.Checking,
  TransactionStatus.CheckingManually,
];

const DEVICE_CONFIRMABLE_STATUSES: readonly TransactionStatus[] = [
  TransactionStatus.Active,
  TransactionStatus.Checking,
  TransactionStatus.CheckingManually,
];

const DECLINABLE_STATUSES: readonly TransactionStatus[] = [
  TransactionStatus.Active,
  TransactionStatus.Checking,
];

@Injectable()
export class TraderDealActionsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly transactions: TransactionService,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
    private readonly requisites: BankDetailsService,
  ) {}

  confirm(actor: TraderDealActor, id: string): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockOwn(manager, actor, id);

      if (deal.status === TransactionStatus.Success) return deal;

      this.assertConfirmable(deal);

      const fromStatus = deal.status;
      const confirmed = await this.transactions.transitionLocked(
        manager,
        deal,
        this.statusChange(actor, TransactionStatus.Success),
      );

      await this.record(manager, actor, 'trader.deal_confirmed', {
        transactionId: id,
        fromStatus,
      });

      return confirmed;
    });
  }

  async confirmByDeviceWithin(
    manager: EntityManager,
    request: DeviceConfirmationRequest,
  ): Promise<DeviceConfirmation> {
    if (request.requisites.length === 0) {
      return { outcome: DeviceMatchOutcome.NoCandidate, transactionId: null };
    }

    const candidates = await manager.find(Transaction, {
      where: {
        traderUserId: request.traderUserId,
        kind: TransactionKind.PayIn,
        bankDetailsId: In(request.requisites.map((requisite) => requisite.id)),
        status: In([...DEVICE_CONFIRMABLE_STATUSES]),
        amountFiat: request.amountFiat,
        createdAt: LessThanOrEqual(request.createdNoLaterThan),
      },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    if (candidates.length === 0) {
      return { outcome: DeviceMatchOutcome.NoCandidate, transactionId: null };
    }

    if (candidates.length > 1) {
      return { outcome: DeviceMatchOutcome.Ambiguous, transactionId: null };
    }

    const [deal] = candidates;
    const requisite = request.requisites.find(
      (candidate) => candidate.id === deal.bankDetailsId,
    );

    if (requisite?.bankId !== request.bankId) {
      return { outcome: DeviceMatchOutcome.BankMismatch, transactionId: null };
    }

    const fromStatus = deal.status;

    await this.transactions.transitionLocked(manager, deal, {
      toStatus: TransactionStatus.Success,
      source: StatusEventSource.Device,
      actorUserId: request.traderUserId,
    });
    await this.audit.record(
      {
        actorUserId: request.traderUserId,
        targetUserId: request.traderUserId,
        action: 'device.deal_confirmed',
        metadata: {
          transactionId: deal.id,
          fromStatus,
          deviceId: request.deviceId,
          messageId: request.messageId,
          amountFiat: formatFiat(request.amountFiat),
        },
      },
      manager,
    );

    return { outcome: DeviceMatchOutcome.Matched, transactionId: deal.id };
  }

  confirmChanged(
    actor: TraderDealActor,
    id: string,
    amountFiat: Fiat,
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockOwn(manager, actor, id);

      if (
        deal.status === TransactionStatus.SuccessChanged &&
        deal.amountFiat.eq(amountFiat)
      ) {
        return deal;
      }

      this.assertConfirmable(deal);

      const shares = await manager.find(TransactionLeadShare, {
        where: { transactionId: id },
        order: { id: 'ASC' },
      });
      const figures = recomputeChangedDeal(deal, shares, amountFiat);
      const amountByShare = new Map(
        figures.leadShares.map((share) => [share.shareId, share.amount]),
      );

      const creditedLeads = shares
        .filter((share) => amountByShare.get(share.id)?.gt(0))
        .map((share) => share.leadUserId);

      await this.wallets.lockWalletsWithin(
        manager,
        [actor.traderUserId, ...creditedLeads],
        creditedLeads,
      );
      await this.moveEscrow(manager, actor, deal, figures.traderAmount);

      for (const share of shares) {
        share.amount = amountByShare.get(share.id) ?? share.amount;
      }
      await manager.save(shares);

      const fromStatus = deal.status;
      const originalAmountFiat = deal.amountFiat;

      Object.assign(deal, {
        originalAmountFiat,
        originalAmountCrypto: deal.amountCrypto,
        originalMerchantCommission: deal.merchantCommission,
        originalTraderCommission: deal.traderCommission,
        originalLeadCommission: deal.leadCommission,
        originalTraderAmount: deal.traderAmount,
        originalMerchantAmount: deal.merchantAmount,
        amountFiat,
        amountCrypto: figures.amountCrypto,
        merchantCommission: figures.merchantCommission,
        traderCommission: figures.traderCommission,
        leadCommission: figures.leadCommission,
        traderAmount: figures.traderAmount,
        merchantAmount: figures.merchantAmount,
      });

      const changed = await this.transactions.transitionLocked(
        manager,
        deal,
        this.statusChange(actor, TransactionStatus.SuccessChanged),
      );

      await this.record(manager, actor, 'trader.deal_confirmed_changed', {
        transactionId: id,
        fromStatus,
        amountFiat: formatFiat(amountFiat),
        originalAmountFiat: formatFiat(originalAmountFiat),
      });

      return changed;
    });
  }

  decline(
    actor: TraderDealActor,
    id: string,
    reasonCode: PayInDeclineReason,
    comment: string | null,
  ): Promise<Transaction> {
    if (reasonCode === PayInDeclineReason.Other && !comment) {
      throw new BadRequestException('A comment is required for this reason');
    }

    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockOwn(manager, actor, id);

      if (!DECLINABLE_STATUSES.includes(deal.status)) {
        throw new ConflictException('The deal cannot be declined');
      }

      if (reasonCode === PayInDeclineReason.RequisiteBlocked) {
        await this.requisites.disableOwnWithin(
          manager,
          deal.bankDetailsId,
          actor.traderUserId,
          actor.impersonatorUserId,
        );
      }

      deal.declineReasonCode = reasonCode;
      deal.declineComment = comment;

      const declined = await this.transactions.transitionLocked(manager, deal, {
        ...this.statusChange(actor, TransactionStatus.Canceled),
        reason: reasonCode,
      });

      await this.record(manager, actor, 'trader.deal_declined', {
        transactionId: id,
        reasonCode,
        comment,
      });

      return declined;
    });
  }

  private async moveEscrow(
    manager: EntityManager,
    actor: TraderDealActor,
    deal: Transaction,
    traderAmount: Crypto,
  ): Promise<void> {
    if (traderAmount.eq(deal.traderAmount)) return;

    if (traderAmount.lt(deal.traderAmount)) {
      await this.wallets.releaseEscrowWithin(
        manager,
        actor.traderUserId,
        roundCrypto(deal.traderAmount.minus(traderAmount)),
      );

      return;
    }

    try {
      await this.wallets.reserveMainEscrowWithin(
        manager,
        actor.traderUserId,
        roundCrypto(traderAmount.minus(deal.traderAmount)),
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Not enough available balance to cover the new amount',
        });
      }

      throw error;
    }
  }

  private assertConfirmable(deal: Transaction): void {
    if (!CONFIRMABLE_STATUSES.includes(deal.status)) {
      throw new ConflictException('The deal cannot be confirmed');
    }
  }

  private statusChange(actor: TraderDealActor, toStatus: TransactionStatus) {
    return {
      toStatus,
      source: StatusEventSource.Trader,
      actorUserId: actor.traderUserId,
    };
  }

  private record(
    manager: EntityManager,
    actor: TraderDealActor,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<unknown> {
    return this.audit.record(
      {
        actorUserId: actor.traderUserId,
        impersonatorUserId: actor.impersonatorUserId,
        targetUserId: actor.traderUserId,
        action,
        metadata,
      },
      manager,
    );
  }

  private async lockOwn(
    manager: EntityManager,
    actor: TraderDealActor,
    id: string,
  ): Promise<Transaction> {
    const deal = await manager.findOne(Transaction, {
      where: {
        id,
        traderUserId: actor.traderUserId,
        kind: TransactionKind.PayIn,
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (!deal) throw new NotFoundException('Deal not found');

    return deal;
  }
}
