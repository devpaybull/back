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
  In,
  Repository,
} from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Fiat } from '../../common/types/fiat';
import { MerchantCallbackEvent } from '../../merchant-callbacks/types/merchant-callback-event.enum';
import { Page, toPage } from '../../common/types/page';
import { formatFiat } from '../../common/utils/format-fiat';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionFile } from '../entities/transaction-file.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { Transaction } from '../entities/transaction.entity';
import { AdminDealActor } from '../types/admin-deal-actor';
import { DisputeListQuery } from '../types/dispute-list-query';
import { DisputeSource } from '../types/dispute-source';
import { DisputeStatus } from '../types/dispute-status.enum';
import { DisputeTraderAction } from '../types/dispute-trader-action.enum';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TraderDealActor } from '../types/trader-deal-actor';
import { TransactionFileKind } from '../types/transaction-file-kind.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { TransactionUpload } from '../types/transaction-upload';
import { dealNotFound } from '../utils/deal-not-found';
import { MERCHANT_CANCELED_REASON } from '../utils/merchant-canceled-reason';
import { DealCallbacksService } from './deal-callbacks.service';
import { DisputeMoneyService } from './dispute-money.service';
import { TransactionFilesService } from './transaction-files.service';
import { TransactionService } from './transaction.service';
import { WalletService } from './wallet.service';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DISPUTE_MAX_AGE_DAYS = 14;
const TRADER_SILENT_REASON = 'trader_did_not_respond';
const SETTLED: readonly TransactionStatus[] = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];
const OPENABLE: Record<TransactionKind, readonly TransactionStatus[]> = {
  [TransactionKind.PayIn]: [
    TransactionStatus.Active,
    TransactionStatus.Canceled,
    ...SETTLED,
  ],
  [TransactionKind.PayOut]: [TransactionStatus.Checking, ...SETTLED],
};
const PAY_IN_RUNNING: readonly TransactionStatus[] = [
  TransactionStatus.Active,
  TransactionStatus.Checking,
  TransactionStatus.CheckingManually,
];
const ADMIN_NOT_OPENABLE: Record<
  TransactionKind,
  readonly TransactionStatus[]
> = {
  [TransactionKind.PayIn]: [
    TransactionStatus.Dispute,
    TransactionStatus.ManualReview,
  ],
  [TransactionKind.PayOut]: [
    TransactionStatus.Dispute,
    TransactionStatus.ManualReview,
  ],
};
const NOT_ALLOWED = (message: string) =>
  new ConflictException({
    statusCode: 409,
    code: 'DISPUTE_NOT_ALLOWED',
    message,
  });

@Injectable()
export class DisputesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(TransactionDispute)
    private readonly disputes: Repository<TransactionDispute>,
    private readonly transactions: TransactionService,
    private readonly money: DisputeMoneyService,
    private readonly files: TransactionFilesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly dealCallbacks: DealCallbacksService,
    private readonly wallets: WalletService,
  ) {}

  openByMerchant(
    merchantId: string,
    transactionId: string,
    fileKeys: readonly string[],
    amountFiat: Fiat | null,
    now: Date = new Date(),
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await manager.findOne(Transaction, {
        where: { id: transactionId, merchantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!deal) throw dealNotFound();

      if (deal.traderUserId) {
        await this.wallets.lockWalletsWithin(
          manager,
          [deal.traderUserId],
          [deal.traderUserId],
        );
      }

      if (
        now.getTime() - deal.createdAt.getTime() >
        DISPUTE_MAX_AGE_DAYS * DAY_MS
      ) {
        throw NOT_ALLOWED(
          `A deal older than ${DISPUTE_MAX_AGE_DAYS} days cannot be disputed`,
        );
      }

      if (!OPENABLE[deal.kind].includes(deal.status)) {
        throw NOT_ALLOWED(`A deal in ${deal.status} cannot be disputed`);
      }

      if (
        await manager.exists(TransactionDispute, {
          where: {
            transactionId,
            status: In([
              DisputeStatus.Deferred,
              DisputeStatus.Open,
              DisputeStatus.Reviewing,
            ]),
          },
        })
      ) {
        throw NOT_ALLOWED('This deal already has a dispute');
      }

      await this.assertNotCanceledByMerchant(manager, deal);
      this.assertOpeningAmount(deal, amountFiat);

      const files = await this.ownUnattachedFiles(
        manager,
        transactionId,
        fileKeys,
      );
      const deferred = deal.status === TransactionStatus.Active;
      const dispute = await manager.save(
        manager.create(TransactionDispute, {
          transactionId,
          status: deferred ? DisputeStatus.Deferred : DisputeStatus.Open,
          statusBefore: deal.status,
          amountFiat,
          openedAt: now,
          traderDeadlineAt: deferred ? null : this.traderDeadline(deal, now),
        }),
      );

      await manager.update(
        TransactionFile,
        { id: In(files.map((file) => file.id)) },
        { disputeId: dispute.id },
      );

      if (!deferred) {
        await this.transactions.moveForDisputeLocked(manager, deal, {
          toStatus: TransactionStatus.Dispute,
          source: StatusEventSource.Merchant,
          actorUserId: null,
        });
      }

      await this.audit.record(
        {
          actorUserId: null,
          action: 'merchant_api.dispute_opened',
          metadata: {
            merchantId,
            transactionId,
            disputeId: dispute.id,
            amountFiat: amountFiat ? formatFiat(amountFiat) : null,
          },
        },
        manager,
      );
      await this.announce(manager, deal);

      return deal;
    });
  }

  async openByAdmin(
    admin: AdminDealActor,
    transactionId: string,
    upload: TransactionUpload,
    amountFiat: Fiat | null,
    now: Date = new Date(),
  ): Promise<Transaction> {
    if (
      !(await this.dataSource.manager.exists(Transaction, {
        where: { id: transactionId },
      }))
    ) {
      throw new NotFoundException('Transaction not found');
    }

    const stored = await this.files.store(transactionId, upload);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const deal = await manager.findOneOrFail(Transaction, {
          where: { id: transactionId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!deal.traderUserId) {
          throw new ConflictException({
            statusCode: 409,
            code: 'NO_TRADER_TO_DISPUTE',
            message: 'Nobody holds this deal, so nobody can answer a dispute',
          });
        }

        await this.wallets.lockWalletsWithin(
          manager,
          [deal.traderUserId],
          [deal.traderUserId],
        );

        if (ADMIN_NOT_OPENABLE[deal.kind].includes(deal.status)) {
          throw NOT_ALLOWED(`A deal in ${deal.status} cannot be disputed`);
        }

        if (
          await manager.exists(TransactionDispute, {
            where: {
              transactionId,
              status: In([
                DisputeStatus.Deferred,
                DisputeStatus.Open,
                DisputeStatus.Reviewing,
              ]),
            },
          })
        ) {
          throw NOT_ALLOWED('This deal already has a dispute');
        }

        const payIn = deal.kind === TransactionKind.PayIn;

        if (payIn) this.assertOpeningAmount(deal, amountFiat);

        const deferred = payIn && PAY_IN_RUNNING.includes(deal.status);
        const dispute = await manager.save(
          manager.create(TransactionDispute, {
            transactionId,
            status: deferred ? DisputeStatus.Deferred : DisputeStatus.Open,
            statusBefore: deal.status,
            amountFiat: payIn ? amountFiat : null,
            openedAt: now,
            traderDeadlineAt: deferred ? null : this.traderDeadline(deal, now),
          }),
        );

        await this.files.recordWithin(
          manager,
          transactionId,
          TransactionFileKind.DisputeReceipt,
          stored,
          admin.userId,
          dispute.id,
        );

        if (!deferred) {
          await this.transactions.moveForDisputeLocked(manager, deal, {
            toStatus: TransactionStatus.Dispute,
            source: StatusEventSource.Admin,
            actorUserId: admin.userId,
          });
        }

        await this.audit.record(
          {
            actorUserId: admin.userId,
            targetUserId: deal.traderUserId,
            action: 'admin.dispute_opened',
            metadata: {
              transactionId,
              disputeId: dispute.id,
              statusBefore: dispute.statusBefore,
              amountFiat: payIn && amountFiat ? formatFiat(amountFiat) : null,
            },
          },
          manager,
        );
        await this.announce(manager, deal);

        return deal;
      });
    } catch (error) {
      await this.files.discard(stored);
      throw error;
    }
  }

  cancelByMerchant(
    merchantId: string,
    transactionId: string,
    now: Date = new Date(),
  ): Promise<Transaction> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await manager.findOne(Transaction, {
        where: { id: transactionId, merchantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!deal) throw dealNotFound();

      const dispute = await this.lockLive(manager, transactionId);

      if (
        !dispute ||
        ![DisputeStatus.Deferred, DisputeStatus.Open].includes(dispute.status)
      ) {
        throw NOT_ALLOWED('There is no dispute that can be canceled');
      }

      const wasOpen = dispute.status === DisputeStatus.Open;

      dispute.status = DisputeStatus.Canceled;
      dispute.resolvedAt = now;
      await manager.save(dispute);

      if (wasOpen) {
        await this.transactions.moveForDisputeLocked(manager, deal, {
          toStatus: dispute.statusBefore,
          source: StatusEventSource.Merchant,
          actorUserId: null,
          reason: 'dispute_canceled',
        });
      }

      await this.audit.record(
        {
          actorUserId: null,
          action: 'merchant_api.dispute_canceled',
          metadata: { merchantId, transactionId, disputeId: dispute.id },
        },
        manager,
      );
      await this.announce(manager, deal);

      return deal;
    });
  }

  acceptByTrader(
    actor: TraderDealActor,
    disputeId: number,
    now: Date = new Date(),
  ): Promise<TransactionDispute> {
    return this.dataSource.transaction(async (manager) => {
      const { deal, dispute } = await this.lockForTrader(
        manager,
        actor,
        disputeId,
      );

      this.assertOpen(dispute);
      dispute.traderAction = DisputeTraderAction.Accepted;
      dispute.traderRespondedAt = now;

      await this.acceptLocked(
        manager,
        deal,
        dispute,
        dispute.amountFiat,
        { source: StatusEventSource.Trader, actorUserId: actor.traderUserId },
        now,
      );
      await this.audit.record(
        {
          actorUserId: actor.traderUserId,
          impersonatorUserId: actor.impersonatorUserId,
          targetUserId: actor.traderUserId,
          action: 'trader.appeal_accepted',
          metadata: { transactionId: deal.id, disputeId },
        },
        manager,
      );
      await this.announce(manager, deal);

      return dispute;
    });
  }

  async contestByTrader(
    actor: TraderDealActor,
    disputeId: number,
    uploads: readonly TransactionUpload[],
    comment: string | null,
    now: Date = new Date(),
  ): Promise<TransactionDispute> {
    if (uploads.length === 0) {
      throw new BadRequestException('At least one evidence file is required');
    }

    const known = await this.disputes.findOne({ where: { id: disputeId } });

    if (!known) throw new NotFoundException('Appeal not found');

    const stored = [];

    try {
      for (const upload of uploads) {
        stored.push(await this.files.store(known.transactionId, upload));
      }

      return await this.dataSource.transaction(async (manager) => {
        const { deal, dispute } = await this.lockForTrader(
          manager,
          actor,
          disputeId,
        );

        this.assertOpen(dispute);

        if (
          dispute.traderDeadlineAt &&
          dispute.traderDeadlineAt.getTime() <= now.getTime()
        ) {
          throw new ConflictException('The time to contest has passed');
        }

        for (const file of stored) {
          await this.files.recordWithin(
            manager,
            deal.id,
            TransactionFileKind.TraderEvidence,
            file,
            actor.traderUserId,
            dispute.id,
          );
        }

        dispute.status = DisputeStatus.Reviewing;
        dispute.traderAction = DisputeTraderAction.Contested;
        dispute.traderRespondedAt = now;
        dispute.traderComment = comment;
        await manager.save(dispute);
        await this.transactions.moveForDisputeLocked(manager, deal, {
          toStatus: TransactionStatus.ManualReview,
          source: StatusEventSource.Trader,
          actorUserId: actor.traderUserId,
        });
        await this.audit.record(
          {
            actorUserId: actor.traderUserId,
            impersonatorUserId: actor.impersonatorUserId,
            targetUserId: actor.traderUserId,
            action: 'trader.appeal_contested',
            metadata: { transactionId: deal.id, disputeId, comment },
          },
          manager,
        );
        await this.announce(manager, deal);

        return dispute;
      });
    } catch (error) {
      await Promise.all(stored.map((file) => this.files.discard(file)));
      throw error;
    }
  }

  acceptByAdmin(
    adminUserId: string,
    disputeId: number,
    amountFiat: Fiat | null,
    now: Date = new Date(),
    confirmOverdraft = false,
  ): Promise<TransactionDispute> {
    return this.dataSource.transaction(async (manager) => {
      const { deal, dispute } = await this.lockForAdmin(manager, disputeId);

      if (amountFiat && deal.kind === TransactionKind.PayOut) {
        throw new BadRequestException('A pay-out dispute has no amount');
      }

      dispute.resolvedByUserId = adminUserId;
      await this.acceptLocked(
        manager,
        deal,
        dispute,
        amountFiat ?? dispute.amountFiat,
        { source: StatusEventSource.Admin, actorUserId: adminUserId },
        now,
        confirmOverdraft,
      );
      await this.audit.record(
        {
          actorUserId: adminUserId,
          targetUserId: deal.traderUserId,
          action: 'admin.dispute_accepted',
          metadata: {
            transactionId: deal.id,
            disputeId,
            amountFiat: amountFiat ? formatFiat(amountFiat) : null,
            confirmOverdraft,
          },
        },
        manager,
      );
      await this.announce(manager, deal);

      return dispute;
    });
  }

  rejectByAdmin(
    adminUserId: string,
    disputeId: number,
    reason: string,
    now: Date = new Date(),
  ): Promise<TransactionDispute> {
    return this.dataSource.transaction(async (manager) => {
      const { deal, dispute } = await this.lockForAdmin(manager, disputeId);

      dispute.status = DisputeStatus.Rejected;
      dispute.declineReason = reason;
      dispute.resolvedAt = now;
      dispute.resolvedByUserId = adminUserId;
      await manager.save(dispute);
      await this.transactions.moveForDisputeLocked(manager, deal, {
        toStatus: dispute.statusBefore,
        source: StatusEventSource.Admin,
        actorUserId: adminUserId,
        reason,
      });
      await this.audit.record(
        {
          actorUserId: adminUserId,
          targetUserId: deal.traderUserId,
          action: 'admin.dispute_rejected',
          reason,
          metadata: { transactionId: deal.id, disputeId },
        },
        manager,
      );
      await this.announce(manager, deal);

      return dispute;
    });
  }

  async escalateOverdue(id: number, now: Date): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const known = await manager.findOne(TransactionDispute, {
        where: { id },
      });

      if (!known) return false;

      const deal = await manager
        .getRepository(Transaction)
        .createQueryBuilder('transaction')
        .where('transaction.id = :id', { id: known.transactionId })
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();

      if (!deal) return false;

      const dispute = await this.lockLive(manager, deal.id);

      if (
        dispute?.id !== id ||
        dispute.status !== DisputeStatus.Open ||
        !dispute.traderDeadlineAt ||
        dispute.traderDeadlineAt.getTime() > now.getTime()
      ) {
        return false;
      }

      dispute.status = DisputeStatus.Reviewing;
      await manager.save(dispute);
      await this.transactions.moveForDisputeLocked(manager, deal, {
        toStatus: TransactionStatus.ManualReview,
        source: StatusEventSource.AutoTimer,
        actorUserId: null,
        reason: TRADER_SILENT_REASON,
      });
      await this.announce(manager, deal);

      return true;
    });
  }

  async list(query: DisputeListQuery): Promise<Page<TransactionDispute>> {
    const where: FindOptionsWhere<TransactionDispute> = {
      ...(query.statuses?.length ? { status: In(query.statuses) } : {}),
      ...(query.transactionId ? { transactionId: query.transactionId } : {}),
      ...(query.traderUserId
        ? { transaction: { traderUserId: query.traderUserId } }
        : {}),
    };

    return toPage(
      await this.disputes.findAndCount({
        where,
        relations: { transaction: true },
        order: { openedAt: query.sortOrder, id: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async findOne(id: number): Promise<TransactionDispute> {
    const dispute = await this.disputes.findOne({
      where: { id },
      relations: { transaction: true },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');

    return dispute;
  }

  latestOf(transactionIds: string[]): Promise<TransactionDispute[]> {
    if (transactionIds.length === 0) return Promise.resolve([]);

    return this.disputes
      .createQueryBuilder('dispute')
      .distinctOn(['dispute.transactionId'])
      .where('dispute.transactionId IN (:...transactionIds)', {
        transactionIds,
      })
      .orderBy('dispute.transactionId')
      .addOrderBy('dispute.id', 'DESC')
      .getMany();
  }

  private async acceptLocked(
    manager: EntityManager,
    deal: Transaction,
    dispute: TransactionDispute,
    amountFiat: Fiat | null,
    source: DisputeSource,
    now: Date,
    confirmOverdraft = false,
  ): Promise<void> {
    const toStatus = await this.money.acceptWithin(
      manager,
      deal,
      dispute.statusBefore,
      amountFiat,
      now,
      confirmOverdraft,
    );

    dispute.status = DisputeStatus.Accepted;
    dispute.amountFiat = amountFiat ?? dispute.amountFiat;
    dispute.resolvedAt = now;
    await manager.save(dispute);
    await this.transactions.moveForDisputeLocked(manager, deal, {
      toStatus,
      source: source.source,
      actorUserId: source.actorUserId,
      reason: 'dispute_accepted',
    });
  }

  private async announce(
    manager: EntityManager,
    deal: Transaction,
  ): Promise<void> {
    await this.dealCallbacks.recordWithin(
      manager,
      deal,
      MerchantCallbackEvent.DisputeChanged,
    );
  }

  private async assertNotCanceledByMerchant(
    manager: EntityManager,
    deal: Transaction,
  ): Promise<void> {
    if (
      deal.status === TransactionStatus.Canceled &&
      (await manager.exists(TransactionStatusEvent, {
        where: {
          transactionId: deal.id,
          toStatus: TransactionStatus.Canceled,
          reason: MERCHANT_CANCELED_REASON,
        },
      }))
    ) {
      throw NOT_ALLOWED(
        'A deal the merchant canceled itself cannot be disputed',
      );
    }
  }

  private assertOpeningAmount(
    deal: Transaction,
    amountFiat: Fiat | null,
  ): void {
    if (deal.kind === TransactionKind.PayOut) {
      if (amountFiat) {
        throw new BadRequestException('A pay-out dispute has no amount');
      }

      return;
    }

    if (SETTLED.includes(deal.status) && !amountFiat?.gt(deal.amountFiat)) {
      throw new BadRequestException(
        'A settled deal can only be disputed for more than its amount',
      );
    }
  }

  private async ownUnattachedFiles(
    manager: EntityManager,
    transactionId: string,
    fileKeys: readonly string[],
  ): Promise<TransactionFile[]> {
    const distinctKeys = [...new Set(fileKeys)];
    const files = await manager.find(TransactionFile, {
      where: {
        id: In(distinctKeys),
        transactionId,
        kind: TransactionFileKind.DisputeReceipt,
      },
    });

    if (
      files.length !== distinctKeys.length ||
      files.some((file) => file.disputeId !== null)
    ) {
      throw new BadRequestException(
        'fileKeys must be unused files uploaded for this deal',
      );
    }

    return files;
  }

  private traderDeadline(deal: Transaction, now: Date): Date {
    return deal.kind === TransactionKind.PayIn
      ? this.transactions.payInAppealDeadline(now)
      : new Date(
          now.getTime() +
            this.config.getOrThrow<number>('PAYOUT_APPEAL_RESPONSE_HOURS') *
              HOUR_MS,
        );
  }

  private assertOpen(dispute: TransactionDispute): void {
    if (dispute.status !== DisputeStatus.Open) {
      throw new ConflictException('This appeal is no longer waiting for you');
    }
  }

  private lockLive(
    manager: EntityManager,
    transactionId: string,
  ): Promise<TransactionDispute | null> {
    return manager.findOne(TransactionDispute, {
      where: {
        transactionId,
        status: In([
          DisputeStatus.Deferred,
          DisputeStatus.Open,
          DisputeStatus.Reviewing,
        ]),
      },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async lockForTrader(
    manager: EntityManager,
    actor: TraderDealActor,
    disputeId: number,
  ): Promise<{ deal: Transaction; dispute: TransactionDispute }> {
    const known = await manager.findOne(TransactionDispute, {
      where: { id: disputeId },
    });
    const deal =
      known &&
      (await manager.findOne(Transaction, {
        where: { id: known.transactionId, traderUserId: actor.traderUserId },
        lock: { mode: 'pessimistic_write' },
      }));

    if (!deal) throw new NotFoundException('Appeal not found');

    const dispute = await manager.findOneOrFail(TransactionDispute, {
      where: { id: disputeId },
      lock: { mode: 'pessimistic_write' },
    });

    return { deal, dispute };
  }

  private async lockForAdmin(
    manager: EntityManager,
    disputeId: number,
  ): Promise<{ deal: Transaction; dispute: TransactionDispute }> {
    const known = await manager.findOne(TransactionDispute, {
      where: { id: disputeId },
    });

    if (!known) throw new NotFoundException('Dispute not found');

    const deal = await manager.findOneOrFail(Transaction, {
      where: { id: known.transactionId },
      lock: { mode: 'pessimistic_write' },
    });
    const dispute = await manager.findOneOrFail(TransactionDispute, {
      where: { id: disputeId },
      lock: { mode: 'pessimistic_write' },
    });

    if (
      ![DisputeStatus.Open, DisputeStatus.Reviewing].includes(dispute.status)
    ) {
      throw new ConflictException('This dispute is not waiting for a decision');
    }

    return { deal, dispute };
  }
}
