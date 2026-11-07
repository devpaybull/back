import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Crypto } from '../../common/types/crypto';
import { formatCrypto } from '../../common/utils/format-crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { MerchantAttachmentsService } from '../../merchants/services/merchant-attachments.service';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { PayoutDecline } from '../entities/payout-decline.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { Transaction } from '../entities/transaction.entity';
import { Wallet } from '../entities/wallet.entity';
import { PayoutDeclineKind } from '../types/payout-decline-kind.enum';
import { PayoutDeclineReason } from '../types/payout-decline-reason.enum';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TraderDealActor } from '../types/trader-deal-actor';
import { TransactionFileKind } from '../types/transaction-file-kind.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { TransactionUpload } from '../types/transaction-upload';
import { PayoutPricingService } from './payout-pricing.service';
import { TransactionFilesService } from './transaction-files.service';
import { TransactionService } from './transaction.service';
import { WalletService } from './wallet.service';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const ASSIGNED_MANUALLY = 'manual';

const refused = (
  Exception: typeof ConflictException | typeof ForbiddenException,
  statusCode: number,
  code: string,
  message: string,
) => new Exception({ statusCode, code, message });

@Injectable()
export class TraderPayoutActionsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly transactions: TransactionService,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
    private readonly settings: TraderSettingsService,
    private readonly attachments: MerchantAttachmentsService,
    private readonly pricing: PayoutPricingService,
    private readonly files: TransactionFilesService,
    private readonly config: ConfigService,
  ) {}

  async take(
    actor: TraderDealActor,
    id: string,
    now: Date = new Date(),
  ): Promise<Transaction> {
    const traderSettings = await this.settings.findOrDefaults(
      actor.traderUserId,
    );

    if (!traderSettings.payoutTradingEnabled) {
      throw refused(
        ForbiddenException,
        403,
        'PAYOUTS_ACCESS_DISABLED',
        'Pay-outs are switched off for this trader',
      );
    }

    const offered = await this.dataSource.manager.findOne(Transaction, {
      where: { id, kind: TransactionKind.PayOut },
    });

    if (!offered) throw new NotFoundException('Pay-out not found');

    await this.assertAdmitted(offered, actor.traderUserId);

    const price = await this.pricing.priceFor(
      offered,
      actor.traderUserId,
      traderSettings.individualRatesEnabled,
    );

    if (!price) {
      throw refused(
        ConflictException,
        409,
        'RATE_NOT_FOUND',
        'There is no rate of this trader for this pay-out',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const deal = await manager.findOne(Transaction, {
        where: { id, kind: TransactionKind.PayOut },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        !deal ||
        deal.status !== TransactionStatus.Pending ||
        deal.traderUserId !== null
      ) {
        throw refused(
          ConflictException,
          409,
          'ALREADY_TAKEN',
          'This pay-out is no longer available',
        );
      }

      if (!deal.expiresAt || deal.expiresAt.getTime() <= now.getTime()) {
        throw refused(
          ConflictException,
          409,
          'ALREADY_TAKEN',
          'This pay-out has expired',
        );
      }

      const [wallet] = await this.wallets.lockWalletsWithin(
        manager,
        [actor.traderUserId],
        [actor.traderUserId],
      );

      if (
        wallet.insurancePayOutBalance.lt(
          this.settings.insurancePayOutMinOf(traderSettings),
        )
      ) {
        throw refused(
          ForbiddenException,
          403,
          'INSURANCE_BELOW_MINIMUM',
          'The pay-out insurance is below its minimum',
        );
      }

      await this.assertBelowActiveLimit(
        manager,
        actor.traderUserId,
        traderSettings.maxActivePayouts,
      );

      if (!traderSettings.trustedUser) {
        const room = roundCrypto(
          wallet.insurancePayOutBalance.minus(
            await this.occupiedInsuranceWithin(
              manager,
              actor.traderUserId,
              now,
            ),
          ),
        );

        if (price.traderAmount.gt(room)) {
          throw refused(
            ConflictException,
            409,
            'PAYOUT_INSURANCE_LIMIT',
            'The pay-out insurance does not cover this pay-out now',
          );
        }
      }

      Object.assign(deal, {
        traderUserId: actor.traderUserId,
        traderPercent: price.traderPercent,
        traderEffectivePercent: price.traderEffectivePercent,
        leadPercent: price.leadPercent,
        traderCommission: price.traderCommission,
        leadCommission: price.leadCommission,
        traderAmount: price.traderAmount,
        payoutTakenAt: now,
        payoutDeadlineAt: new Date(
          now.getTime() +
            this.config.getOrThrow<number>('PAYOUT_PAYMENT_WINDOW_MINUTES') *
              MINUTE_MS,
        ),
        payoutAssignedBy: ASSIGNED_MANUALLY,
      });

      if (price.leadShares.length) {
        await manager.save(
          price.leadShares.map((share) =>
            manager.create(TransactionLeadShare, {
              transactionId: id,
              leadUserId: share.leadUserId,
              percent: share.percent,
              amount: share.amount,
            }),
          ),
        );
      }

      const taken = await this.transactions.transitionLocked(manager, deal, {
        toStatus: TransactionStatus.Active,
        source: StatusEventSource.Trader,
        actorUserId: actor.traderUserId,
      });

      await this.record(manager, actor, 'trader.payout_taken', {
        transactionId: id,
        traderAmount: formatCrypto(price.traderAmount),
      });

      return taken;
    });
  }

  async complete(
    actor: TraderDealActor,
    id: string,
    upload: TransactionUpload,
    now: Date = new Date(),
  ): Promise<Transaction> {
    const current = await this.dataSource.manager.findOne(Transaction, {
      where: {
        id,
        traderUserId: actor.traderUserId,
        kind: TransactionKind.PayOut,
      },
    });

    if (!current) throw new NotFoundException('Pay-out not found');
    this.assertInWork(current);

    const stored = await this.files.store(id, upload);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const deal = await this.lockOwn(manager, actor, id);

        this.assertInWork(deal);

        await this.files.recordWithin(
          manager,
          id,
          TransactionFileKind.PayoutReceipt,
          stored,
          actor.traderUserId,
        );
        deal.payoutCompletedAt = now;

        const completed = await this.transactions.transitionLocked(
          manager,
          deal,
          {
            toStatus: TransactionStatus.Checking,
            source: StatusEventSource.Trader,
            actorUserId: actor.traderUserId,
          },
        );

        await this.record(manager, actor, 'trader.payout_completed', {
          transactionId: id,
          fileName: stored.name,
        });

        return completed;
      });
    } catch (error) {
      await this.files.discard(stored);
      throw error;
    }
  }

  decline(
    actor: TraderDealActor,
    id: string,
    reasonCode: PayoutDeclineReason,
    comment: string | null,
  ): Promise<Transaction> {
    if (reasonCode === PayoutDeclineReason.Other && !comment) {
      throw new BadRequestException('A comment is required for this reason');
    }

    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockOwn(manager, actor, id);

      this.assertInWork(deal);

      const released = await this.releaseToPoolWithin(manager, deal, {
        kind: PayoutDeclineKind.Declined,
        reasonCode,
        comment,
        source: StatusEventSource.Trader,
        actorUserId: actor.traderUserId,
      });

      await this.record(manager, actor, 'trader.payout_declined', {
        transactionId: id,
        reasonCode,
        comment,
      });

      return released;
    });
  }

  async releaseToPoolWithin(
    manager: EntityManager,
    deal: Transaction,
    release: {
      kind: PayoutDeclineKind;
      reasonCode: PayoutDeclineReason | null;
      comment: string | null;
      source: StatusEventSource;
      actorUserId: string | null;
    },
  ): Promise<Transaction> {
    await manager.save(
      manager.create(PayoutDecline, {
        transactionId: deal.id,
        traderUserId: deal.traderUserId,
        kind: release.kind,
        reasonCode: release.reasonCode,
        comment: release.comment,
      }),
    );
    await manager.delete(TransactionLeadShare, { transactionId: deal.id });

    Object.assign(deal, {
      traderUserId: null,
      traderPercent: null,
      traderEffectivePercent: null,
      leadPercent: null,
      traderCommission: null,
      leadCommission: null,
      traderAmount: null,
      payoutTakenAt: null,
      payoutDeadlineAt: null,
      payoutAssignedBy: null,
    });

    return this.transactions.transitionLocked(manager, deal, {
      toStatus: TransactionStatus.Pending,
      source: release.source,
      actorUserId: release.actorUserId,
      reason: release.reasonCode ?? release.kind,
    });
  }

  async insuranceRoomOf(
    wallet: Wallet | null,
    traderUserId: string,
    now: Date,
  ): Promise<Crypto> {
    const occupied = await this.occupiedInsuranceWithin(
      this.dataSource.manager,
      traderUserId,
      now,
    );

    return roundCrypto(
      (wallet?.insurancePayOutBalance ?? toCrypto(0)).minus(occupied),
    );
  }

  private async assertAdmitted(
    deal: Transaction,
    traderUserId: string,
  ): Promise<void> {
    const admission = await this.attachments.admissionOf(
      deal.merchantId,
      deal.method,
    );

    if (admission.attachedTraderIds.has(traderUserId)) return;

    if (
      admission.switchedOffTraderIds.has(traderUserId) ||
      admission.exclusiveTopUp
    ) {
      throw new NotFoundException('Pay-out not found');
    }
  }

  private async assertBelowActiveLimit(
    manager: EntityManager,
    traderUserId: string,
    ownLimit: number | null,
  ): Promise<void> {
    const limit =
      ownLimit ??
      this.config.getOrThrow<number>('PAYOUT_MAX_ACTIVE_PER_TRADER');
    const active = await manager.count(Transaction, {
      where: {
        traderUserId,
        kind: TransactionKind.PayOut,
        status: TransactionStatus.Active,
      },
    });

    if (active >= limit) {
      throw refused(
        ConflictException,
        409,
        'PAYOUT_ACTIVE_LIMIT',
        `At most ${limit} pay-outs can be in work at once`,
      );
    }
  }

  private async occupiedInsuranceWithin(
    manager: EntityManager,
    traderUserId: string,
    now: Date,
  ): Promise<Crypto> {
    const holdStart = new Date(
      now.getTime() -
        this.config.getOrThrow<number>('PAYOUT_INSURANCE_HOLD_MINUTES') *
          MINUTE_MS,
    );
    const nightStart = this.nightStartBefore(now);
    const since =
      this.wallets.isWithinNightWindow(now) && nightStart < holdStart
        ? nightStart
        : holdStart;
    const row = await manager
      .getRepository(Transaction)
      .createQueryBuilder('transaction')
      .select('COALESCE(SUM(transaction.traderAmount), 0)', 'sum')
      .where('transaction.traderUserId = :traderUserId', { traderUserId })
      .andWhere('transaction.kind = :kind', { kind: TransactionKind.PayOut })
      .andWhere('transaction.status != :canceled', {
        canceled: TransactionStatus.Canceled,
      })
      .andWhere('transaction.payoutTakenAt >= :since', { since })
      .getRawOne<{ sum: string }>();

    return toCrypto(toDecimal(row?.sum ?? 0).toFixed(6));
  }

  private nightStartBefore(now: Date): Date {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
    const startHour = this.config.get<number>('INSURANCE_NIGHT_START_HOUR', 0);
    const today = calendarDateIn(now, timeZone);
    const startOn = (day: string): Date =>
      new Date(zonedMidnight(day, timeZone).getTime() + startHour * HOUR_MS);
    const startToday = startOn(today);

    return startToday.getTime() <= now.getTime()
      ? startToday
      : startOn(addCalendarDays(today, -1));
  }

  private assertInWork(deal: Transaction): void {
    if (deal.status !== TransactionStatus.Active) {
      throw new ConflictException('This pay-out is not in work');
    }
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
        kind: TransactionKind.PayOut,
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (!deal) throw new NotFoundException('Pay-out not found');

    return deal;
  }
}
