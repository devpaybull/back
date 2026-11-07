import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Fiat } from '../../common/types/fiat';
import { roundCrypto } from '../../common/utils/round-crypto';
import { roundFiat } from '../../common/utils/round-fiat';
import { toCrypto } from '../../common/utils/to-crypto';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { recomputeChangedPayIn } from '../utils/recompute-changed-pay-in';
import { MerchantBalanceService } from './merchant-balance.service';
import { WalletService } from './wallet.service';
import { CounterpartyStatsService } from '../../counterparties/services/counterparty-stats.service';
import { countsTowardCounterpartyStats } from '../utils/counts-toward-counterparty-stats';

const NOTHING = toCrypto(0);

const SETTLED: readonly TransactionStatus[] = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];

@Injectable()
export class DisputeMoneyService {
  constructor(
    private readonly wallets: WalletService,
    private readonly merchantBalances: MerchantBalanceService,
    private readonly counterpartyStats: CounterpartyStatsService,
  ) {}

  acceptWithin(
    manager: EntityManager,
    deal: Transaction,
    statusBefore: TransactionStatus,
    amountFiat: Fiat | null,
    now: Date,
  ): Promise<TransactionStatus> {
    return deal.kind === TransactionKind.PayIn
      ? this.acceptPayIn(manager, deal, statusBefore, amountFiat, now)
      : this.acceptPayOut(manager, deal, statusBefore, now);
  }

  private async acceptPayIn(
    manager: EntityManager,
    deal: Transaction,
    statusBefore: TransactionStatus,
    requested: Fiat | null,
    now: Date,
  ): Promise<TransactionStatus> {
    const wasSettled = SETTLED.includes(statusBefore);

    if (wasSettled && !requested?.gt(deal.amountFiat)) {
      throw new BadRequestException(
        'A settled deal can only be disputed for more than its amount',
      );
    }

    const amountFiat = requested ?? deal.amountFiat;
    const changed = !amountFiat.eq(deal.amountFiat);
    const previousFiat = deal.amountFiat;
    const shares = await manager.find(TransactionLeadShare, {
      where: { transactionId: deal.id },
      order: { id: 'ASC' },
    });
    const paidBefore = {
      trader: wasSettled ? deal.traderAmount : NOTHING,
      merchant: wasSettled ? deal.merchantAmount : NOTHING,
    };
    const shareBefore = new Map(
      shares.map((share) => [share.id, wasSettled ? share.amount : null]),
    );

    if (changed) {
      const figures = recomputeChangedPayIn(deal, shares, amountFiat);
      const newShare = new Map(
        figures.leadShares.map((share) => [share.shareId, share.amount]),
      );

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
        amountFiat,
        amountCrypto: figures.amountCrypto,
        merchantCommission: figures.merchantCommission,
        traderCommission: figures.traderCommission,
        leadCommission: figures.leadCommission,
        traderAmount: figures.traderAmount,
        merchantAmount: figures.merchantAmount,
      });
      for (const share of shares) {
        share.amount = newShare.get(share.id) ?? share.amount;
      }
      await manager.save(shares);
    }

    const leadCredits = shares
      .map((share) => {
        const before = shareBefore.get(share.id);

        return {
          leadUserId: share.leadUserId,
          amount: before
            ? roundCrypto(share.amount.minus(before))
            : share.amount,
        };
      })
      .filter((credit) => credit.amount.gt(0));

    await this.wallets.lockWalletsWithin(
      manager,
      [deal.traderUserId, ...leadCredits.map((credit) => credit.leadUserId)],
      leadCredits.map((credit) => credit.leadUserId),
    );

    await this.wallets.applyDisputeLossWithin(
      manager,
      deal.traderUserId,
      roundCrypto(deal.traderAmount.minus(paidBefore.trader)),
      deal.id,
    );

    for (const credit of leadCredits) {
      await this.wallets.creditLeadShareWithin(
        manager,
        credit.leadUserId,
        credit.amount,
        deal.id,
      );
    }

    if (deal.merchantId) {
      if (wasSettled) {
        await this.merchantBalances.creditDisputeWithin(
          manager,
          deal.merchantId,
          roundCrypto(deal.merchantAmount.minus(paidBefore.merchant)),
          deal.id,
        );
      } else {
        await this.merchantBalances.creditDealWithin(
          manager,
          deal.merchantId,
          deal.merchantAmount,
          deal.id,
        );
      }
    }

    if (!wasSettled) deal.resolvedAt = now;

    if (countsTowardCounterpartyStats(deal)) {
      await this.counterpartyStats.recordDisputePaidWithin(
        manager,
        deal.counterpartyId,
        {
          newlyPaid: !wasSettled,
          amountFiat: wasSettled
            ? roundFiat(amountFiat.minus(previousFiat))
            : amountFiat,
          resolvedAt: deal.resolvedAt,
        },
      );
    }

    return changed || statusBefore === TransactionStatus.SuccessChanged
      ? TransactionStatus.SuccessChanged
      : TransactionStatus.Success;
  }

  private async acceptPayOut(
    manager: EntityManager,
    deal: Transaction,
    statusBefore: TransactionStatus,
    now: Date,
  ): Promise<TransactionStatus> {
    if (SETTLED.includes(statusBefore)) {
      const shares = (
        await manager.find(TransactionLeadShare, {
          where: { transactionId: deal.id },
          order: { id: 'ASC' },
        })
      ).filter((share) => share.amount.gt(0));

      await this.wallets.lockWalletsWithin(
        manager,
        [deal.traderUserId, ...shares.map((share) => share.leadUserId)],
        [],
      );
      await this.wallets.applyDisputeLossWithin(
        manager,
        deal.traderUserId,
        deal.traderAmount,
        deal.id,
      );

      for (const share of shares) {
        await this.wallets.debitLeadShareWithin(
          manager,
          share.leadUserId,
          share.amount,
          deal.id,
        );
      }

      await this.merchantBalances.creditDisputeWithin(
        manager,
        deal.merchantId,
        deal.merchantAmount,
        deal.id,
      );
    } else {
      await this.merchantBalances.releasePayOutWithin(
        manager,
        deal.merchantId,
        deal.id,
      );
    }

    deal.resolvedAt = now;

    return TransactionStatus.Canceled;
  }
}
