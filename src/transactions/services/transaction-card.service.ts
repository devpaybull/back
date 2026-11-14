import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { Transaction } from '../entities/transaction.entity';
import { AdminDealAction } from '../types/admin-deal-action.enum';
import { DisputeStatus } from '../types/dispute-status.enum';
import { TransactionCard } from '../types/transaction-card';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { AdminDealActionsService } from './admin-deal-actions.service';
import { TransactionFilesService } from './transaction-files.service';

const LIVE_DISPUTES: readonly DisputeStatus[] = [
  DisputeStatus.Deferred,
  DisputeStatus.Open,
  DisputeStatus.Reviewing,
];
const SETTLED: readonly TransactionStatus[] = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];
const CLOSABLE: readonly TransactionStatus[] = [
  TransactionStatus.Active,
  TransactionStatus.Checking,
  TransactionStatus.CheckingManually,
];
const IN_DISPUTE: readonly TransactionStatus[] = [
  TransactionStatus.Dispute,
  TransactionStatus.ManualReview,
];

@Injectable()
export class TransactionCardService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly files: TransactionFilesService,
    private readonly actions: AdminDealActionsService,
  ) {}

  async cardOf(id: string, superadmin: boolean): Promise<TransactionCard> {
    const manager = this.dataSource.manager;
    const deal = await manager.findOne(Transaction, { where: { id } });

    if (!deal) throw new NotFoundException('Transaction not found');

    const [events, disputes, leadShares, files, hasCallbackUrl] =
      await Promise.all([
        manager.find(TransactionStatusEvent, {
          where: { transactionId: id },
          order: { createdAt: 'DESC', id: 'DESC' },
        }),
        manager.find(TransactionDispute, {
          where: { transactionId: id },
          order: { createdAt: 'DESC', id: 'DESC' },
        }),
        manager.find(TransactionLeadShare, {
          where: { transactionId: id },
          order: { id: 'ASC' },
        }),
        this.files.listOf([id]),
        this.actions.hasCallbackUrl(deal),
      ]);
    const liveDispute = disputes.some((dispute) =>
      LIVE_DISPUTES.includes(dispute.status),
    );
    const openDispute = disputes.some(
      (dispute) =>
        dispute.status !== DisputeStatus.Deferred &&
        LIVE_DISPUTES.includes(dispute.status),
    );

    return {
      deal,
      events,
      disputes,
      leadShares,
      files,
      actions: this.actionsOf(deal, {
        liveDispute,
        openDispute,
        hasCallbackUrl,
        superadmin,
      }),
    };
  }

  actionsOf(
    deal: Pick<Transaction, 'kind' | 'status' | 'traderUserId'>,
    context: {
      liveDispute: boolean;
      openDispute: boolean;
      hasCallbackUrl: boolean;
      superadmin: boolean;
    },
  ): AdminDealAction[] {
    const payIn = deal.kind === TransactionKind.PayIn;
    const settled = SETTLED.includes(deal.status);
    const canceled = deal.status === TransactionStatus.Canceled;
    const free = !context.liveDispute;
    const offered: [AdminDealAction, boolean][] = [
      [
        AdminDealAction.Close,
        !context.openDispute && payIn && CLOSABLE.includes(deal.status),
      ],
      [AdminDealAction.ChangeAmount, free && context.superadmin && settled],
      [AdminDealAction.CancelSettled, free && context.superadmin && settled],
      [
        AdminDealAction.Restore,
        free && context.superadmin && payIn && canceled,
      ],
      [
        AdminDealAction.OpenDispute,
        free && deal.traderUserId !== null && !IN_DISPUTE.includes(deal.status),
      ],
      [AdminDealAction.SendCallback, context.hasCallbackUrl],
      [
        AdminDealAction.CancelPayout,
        free &&
          !payIn &&
          (deal.status === TransactionStatus.Pending ||
            deal.status === TransactionStatus.Active),
      ],
      [
        AdminDealAction.AssignTrader,
        free &&
          !payIn &&
          ((deal.status === TransactionStatus.Pending &&
            deal.traderUserId === null) ||
            canceled),
      ],
    ];

    return offered.filter(([, allowed]) => allowed).map(([action]) => action);
  }
}
