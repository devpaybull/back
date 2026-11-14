import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Crypto } from '../../common/types/crypto';
import { Page, toPage } from '../../common/types/page';
import { formatCrypto } from '../../common/utils/format-crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { MerchantAttachmentsService } from '../../merchants/services/merchant-attachments.service';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { PayoutDecline } from '../entities/payout-decline.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { Transaction } from '../entities/transaction.entity';
import { Wallet } from '../entities/wallet.entity';
import { PayoutDeclineKind } from '../types/payout-decline-kind.enum';
import { PayoutDeclineReason } from '../types/payout-decline-reason.enum';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TraderDealActor } from '../types/trader-deal-actor';
import { TraderPayoutListQuery } from '../types/trader-payout-list-query';
import { TransactionFileKind } from '../types/transaction-file-kind.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { TransactionUpload } from '../types/transaction-upload';
import { Role } from '../../common/enums/role.enum';
import { MerchantCallbackEvent } from '../../merchant-callbacks/types/merchant-callback-event.enum';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { AdminDealActor } from '../types/admin-deal-actor';
import { DisputeStatus } from '../types/dispute-status.enum';
import { OverdraftParty } from '../types/overdraft-party.enum';
import { PayoutAssignment } from '../types/payout-assignment';
import { PayoutTaker } from '../types/payout-taker';
import { StatusChange } from '../types/status-change';
import { overdraftNotConfirmed } from '../utils/overdraft-not-confirmed';
import { DealCallbacksService } from './deal-callbacks.service';
import { MerchantBalanceService } from './merchant-balance.service';
import { PayoutPricingService } from './payout-pricing.service';
import { TransactionFilesService } from './transaction-files.service';
import { TraderPayoutsService } from './trader-payouts.service';
import { TransactionService } from './transaction.service';
import { WalletService } from './wallet.service';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const ASSIGNED_MANUALLY = 'manual';
const ASSIGNED_BY_ADMIN = 'admin';

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
    private readonly payouts: TraderPayoutsService,
    private readonly users: UserDirectoryService,
    private readonly merchantBalances: MerchantBalanceService,
    private readonly merchantSettings: MerchantSettingsService,
    private readonly dealCallbacks: DealCallbacksService,
  ) {}

  assertPoolOpen(settings: TraderSettings): void {
    if (!settings.payoutTradingEnabled) {
      throw refused(
        ForbiddenException,
        403,
        'PAYOUTS_ACCESS_DISABLED',
        'Pay-outs are switched off for this trader',
      );
    }

    if (!settings.tradingEnabled) {
      throw refused(
        ForbiddenException,
        403,
        'TRADING_DISABLED',
        'Trading is switched off',
      );
    }
  }

  async poolOf(
    traderUserId: string,
    settings: TraderSettings,
    query: TraderPayoutListQuery,
    now: Date,
  ): Promise<Page<Transaction>> {
    const wallet = await this.wallets.findByUserId(traderUserId);
    const belowMinimum = (wallet?.insurancePayOutBalance ?? toCrypto(0)).lt(
      this.settings.insurancePayOutMinOf(settings),
    );
    const room = settings.trustedUser
      ? null
      : await this.insuranceRoomOf(wallet, traderUserId, now);

    if (belowMinimum || room?.lte(0)) return toPage([[], 0], query);

    return this.payouts.pool(
      query,
      await this.attachments.exclusionsOfTrader(traderUserId),
      room,
      now,
    );
  }

  take(
    actor: TraderDealActor,
    id: string,
    now: Date = new Date(),
  ): Promise<Transaction> {
    return this.takeFor(actor.traderUserId, id, now, {
      source: StatusEventSource.Trader,
      actorUserId: actor.traderUserId,
      impersonatorUserId: actor.impersonatorUserId,
      assignedBy: ASSIGNED_MANUALLY,
      action: 'trader.payout_taken',
      admin: null,
    });
  }

  async assignByAdmin(
    admin: AdminDealActor,
    id: string,
    assignment: PayoutAssignment,
    now: Date = new Date(),
  ): Promise<Transaction> {
    const [trader] = await this.users.findByIds([assignment.traderUserId]);

    if (
      !trader ||
      trader.role !== Role.Trader ||
      trader.status !== UserStatus.Active
    ) {
      throw new BadRequestException('traderUserId must be an active trader');
    }

    return this.takeFor(assignment.traderUserId, id, now, {
      source: StatusEventSource.Admin,
      actorUserId: admin.userId,
      impersonatorUserId: null,
      assignedBy: ASSIGNED_BY_ADMIN,
      action: 'admin.payout_assigned',
      admin: { confirmOverdraft: assignment.confirmOverdraft },
    });
  }

  private async takeFor(
    traderUserId: string,
    id: string,
    now: Date,
    by: PayoutTaker,
  ): Promise<Transaction> {
    const traderSettings = await this.settings.findOrDefaults(traderUserId);

    this.assertPoolOpen(traderSettings);

    const offered = await this.dataSource.manager.findOne(Transaction, {
      where: { id, kind: TransactionKind.PayOut },
    });

    if (!offered) throw new NotFoundException('Pay-out not found');

    await this.assertAdmitted(offered, traderUserId).catch((error) => {
      if (by.admin && error instanceof NotFoundException) {
        throw refused(
          ConflictException,
          409,
          'TRADER_NOT_ADMITTED',
          'This trader does not serve the merchant of this pay-out',
        );
      }
      throw error;
    });

    const price = await this.pricing.priceFor(
      offered,
      traderUserId,
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
      const revived =
        by.admin !== null && deal?.status === TransactionStatus.Canceled;

      if (!deal) throw new NotFoundException('Pay-out not found');

      if (revived) {
        await this.assertNoLiveDispute(manager, id);
      } else {
        if (
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
      }

      const [wallet] = await this.wallets.lockWalletsWithin(
        manager,
        [traderUserId],
        [traderUserId],
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
        traderUserId,
        traderSettings.maxActivePayouts,
      );

      if (!traderSettings.trustedUser) {
        const room = roundCrypto(
          wallet.insurancePayOutBalance.minus(
            await this.occupiedInsuranceWithin(manager, traderUserId, now),
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

      const fromStatus = deal.status;

      if (revived) {
        await this.reholdWithin(manager, deal, by);
      }

      await this.wallets.stampAcceptedDealWithin(manager, traderUserId, now);

      Object.assign(deal, {
        traderUserId,
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
        payoutAssignedBy: by.assignedBy,
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

      const change = {
        toStatus: TransactionStatus.Active,
        source: by.source,
        actorUserId: by.actorUserId,
      };
      const taken = revived
        ? await this.reviveLocked(manager, deal, fromStatus, change, now)
        : await this.transactions.transitionLocked(manager, deal, change);

      await this.audit.record(
        {
          actorUserId: by.actorUserId,
          impersonatorUserId: by.impersonatorUserId,
          targetUserId: traderUserId,
          action: by.action,
          metadata: {
            transactionId: id,
            traderAmount: formatCrypto(price.traderAmount),
            ...(by.admin
              ? {
                  fromStatus,
                  confirmOverdraft: by.admin.confirmOverdraft,
                }
              : {}),
          },
        },
        manager,
      );

      return taken;
    });
  }

  private async reholdWithin(
    manager: EntityManager,
    deal: Transaction,
    by: PayoutTaker,
  ): Promise<void> {
    await manager.delete(TransactionLeadShare, { transactionId: deal.id });

    if (!deal.merchantId) return;

    const balance = await this.merchantBalances.lockBalanceWithin(
      manager,
      deal.merchantId,
    );
    const after = roundCrypto(balance.balance.minus(deal.merchantAmount));

    if (after.lt(0) && !by.admin?.confirmOverdraft) {
      throw overdraftNotConfirmed([
        {
          party: OverdraftParty.Merchant,
          id: deal.merchantId,
          shortfall: roundCrypto(after.neg()),
        },
      ]);
    }

    await this.merchantBalances.reholdPayOutWithin(
      manager,
      deal.merchantId,
      deal.merchantAmount,
      deal.id,
      by.actorUserId,
    );
  }

  private async reviveLocked(
    manager: EntityManager,
    deal: Transaction,
    fromStatus: TransactionStatus,
    change: StatusChange,
    now: Date,
  ): Promise<Transaction> {
    const windowMinutes =
      (deal.merchantId
        ? await this.merchantSettings.payInWindowMinutesOf(deal.merchantId)
        : null) ?? this.config.getOrThrow<number>('DEAL_TTL_MINUTES');

    deal.status = TransactionStatus.Active;
    deal.resolvedAt = null;
    deal.payoutCompletedAt = null;
    deal.expiresAt = new Date(now.getTime() + windowMinutes * MINUTE_MS);
    await manager.save(deal);
    await this.transactions.recordEventWithin(
      manager,
      deal.id,
      fromStatus,
      change,
    );
    await this.dealCallbacks.recordWithin(
      manager,
      deal,
      MerchantCallbackEvent.StatusChanged,
    );

    return deal;
  }

  private async assertNoLiveDispute(
    manager: EntityManager,
    transactionId: string,
  ): Promise<void> {
    if (
      await manager.exists(TransactionDispute, {
        where: {
          transactionId,
          status: In([
            DisputeStatus.Open,
            DisputeStatus.Reviewing,
            DisputeStatus.Deferred,
          ]),
        },
      })
    ) {
      throw refused(
        ConflictException,
        409,
        'DEAL_UNDER_DISPUTE',
        'This pay-out has a live dispute',
      );
    }
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
