import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { Page, toPage } from '../../common/types/page';
import { Transaction } from '../entities/transaction.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { CreateDealInput } from '../types/create-deal-input';
import { InternalTransferInput } from '../types/internal-transfer-input';
import { StatusChange } from '../types/status-change';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionListQuery } from '../types/transaction-list-query';
import { TransactionStatus } from '../types/transaction-status.enum';
import { computeDeal } from '../utils/compute-deal';
import {
  canTransition,
  isFinalStatus,
  startStatus,
} from '../utils/status-transitions';
import { transactionListOrder } from '../utils/transaction-list-order';
import { transactionListWhere } from '../utils/transaction-list-where';
import { WalletService } from './wallet.service';

@Injectable()
export class TransactionService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
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
    return toPage(
      await this.transactions.findAndCount({
        where: transactionListWhere(query),
        order: transactionListOrder(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async createDeal(input: CreateDealInput): Promise<Transaction> {
    const computation = computeDeal({
      kind: input.kind,
      amountFiat: input.amountFiat,
      rate: input.rate,
      merchantPercent: input.merchantPercent,
      traderPercent: input.traderPercent,
      leadPercent: input.leadPercent,
    });
    const status = startStatus(input.kind);

    if (input.kind === TransactionKind.PayIn) {
      await this.wallets.reserveMainEscrow(
        input.traderUserId,
        computation.traderAmount,
      );
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
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
          leadPercent: input.leadPercent ?? null,
          merchantCommission: computation.merchantCommission,
          traderCommission: computation.traderCommission,
          leadCommission: computation.leadCommission,
          traderAmount: computation.traderAmount,
          merchantAmount: computation.merchantAmount,
          comment: input.comment ?? null,
        });
        await manager.save(transaction);
        await this.writeEvent(manager, transaction.id, null, {
          toStatus: status,
          source: StatusEventSource.System,
        });
        return transaction;
      });
    } catch (error) {
      if (input.kind === TransactionKind.PayIn) {
        await this.wallets.releaseMainEscrow(
          input.traderUserId,
          computation.traderAmount,
        );
      }
      throw error;
    }
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

      if (
        transaction.status === change.toStatus &&
        isFinalStatus(change.toStatus)
      ) {
        return transaction;
      }

      if (
        !canTransition(transaction.kind, transaction.status, change.toStatus)
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
      return transaction;
    });
  }

  async createInternalTransfer(
    input: InternalTransferInput,
  ): Promise<Transaction> {
    const created = await this.dataSource.transaction(async (manager) => {
      const transaction = manager.create(Transaction, {
        kind: TransactionKind.InternalTransfer,
        status: TransactionStatus.Active,
        traderUserId: input.fromUserId,
        recipientUserId: input.toUserId,
        amountCrypto: input.amount,
        comment: input.comment ?? null,
      });
      await manager.save(transaction);
      await this.writeEvent(manager, transaction.id, null, {
        toStatus: TransactionStatus.Active,
        source: input.source,
        actorUserId: input.actorUserId,
      });
      return transaction;
    });

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.wallets.transferWithin(
          manager,
          input.fromUserId,
          input.toUserId,
          input.amount,
          created.id,
        );
        created.status = TransactionStatus.Success;
        created.resolvedAt = new Date();
        await manager.save(created);
        await this.writeEvent(manager, created.id, TransactionStatus.Active, {
          toStatus: TransactionStatus.Success,
          source: input.source,
          actorUserId: input.actorUserId,
        });
        if (input.actorUserId) {
          await this.audit.record(
            {
              actorUserId: input.actorUserId,
              targetUserId: input.toUserId,
              action: 'user.transfer',
              metadata: {
                transactionId: created.id,
                fromUserId: input.fromUserId,
                toUserId: input.toUserId,
                amount: input.amount,
              },
            },
            manager,
          );
        }
        return created;
      });
    } catch (error) {
      await this.transition(created.id, {
        toStatus: TransactionStatus.Canceled,
        source: input.source,
        actorUserId: input.actorUserId,
        reason: 'Internal transfer failed',
      });
      throw error;
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
      return;
    }

    if (transaction.kind === TransactionKind.PayOut && settled) {
      await this.wallets.creditMainWithin(
        manager,
        transaction.traderUserId,
        transaction.traderAmount,
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
