import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThan,
} from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { ActivityAction } from '../../audit/types/activity-action.enum';
import { Crypto } from '../../common/types/crypto';
import { formatCrypto } from '../../common/utils/format-crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { WalletService } from '../../transactions/services/wallet.service';
import { TronAddress } from '../../tron/entities/tron-address.entity';
import { TronKeyring } from '../../tron/services/tron-keyring.service';
import { TronVerifier } from '../../tron/services/tron-verifier.service';
import { UsdtTransferScanner } from '../../tron/services/usdt-transfer-scanner.service';
import { AddressPurpose } from '../../tron/types/address-purpose.enum';
import { UsdtTransferEvent } from '../../tron/types/usdt-transfer-event';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { DepositAddress } from '../entities/deposit-address.entity';
import { DepositTransfer } from '../entities/deposit-transfer.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';
import { DepositVerification } from '../types/deposit-verification';
import { HashCreditCandidate } from '../types/hash-credit-candidate';
import { HashCreditPlan } from '../types/hash-credit-plan';

const CREDITABLE_STATUSES = [AccountTransactionStatus.Failed];

@Injectable()
export class DepositsService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
    private readonly keyring: TronKeyring,
    private readonly scanner: UsdtTransferScanner,
    private readonly verifier: TronVerifier,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.scanner.register(AddressPurpose.Deposit, (manager, event, address) =>
      this.receive(manager, event, address),
    );
  }

  existingDepositAddressOf(userId: string): Promise<DepositAddress | null> {
    return this.dataSource
      .getRepository(DepositAddress)
      .findOne({ where: { userId } });
  }

  async depositAddressOf(userId: string): Promise<DepositAddress> {
    const existing = await this.existingDepositAddressOf(userId);

    if (existing) return existing;

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `deposit_addresses:${userId}`,
      ]);
      const raced = await manager.findOne(DepositAddress, {
        where: { userId },
      });

      if (raced) return raced;

      const tronAddress = await this.keyring.issueDepositAddress(manager);

      return manager.save(
        manager.create(DepositAddress, {
          userId,
          tronAddressId: tronAddress.id,
          address: tronAddress.address,
        }),
      );
    });
  }

  async createRequest(
    userId: string,
    amount: Crypto,
    now = new Date(),
  ): Promise<AccountTransaction> {
    if (amount.lt(this.minimum())) {
      throw new BadRequestException(
        `The amount is below the minimum deposit of ${formatCrypto(this.minimum())} USDT`,
      );
    }

    const depositAddress = await this.depositAddressOf(userId);

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `deposit_requests:${userId}`,
      ]);
      const live = await manager.count(AccountTransaction, {
        where: {
          type: AccountTransactionType.Deposit,
          userId,
          status: AccountTransactionStatus.Pending,
          expiresAt: MoreThan(now),
        },
      });

      if (
        live >= this.config.getOrThrow<number>('DEPOSIT_MAX_ACTIVE_REQUESTS')
      ) {
        throw new ConflictException('Too many open deposit requests');
      }

      return manager.save(
        manager.create(AccountTransaction, {
          type: AccountTransactionType.Deposit,
          status: AccountTransactionStatus.Pending,
          statusReason: null,
          userId,
          amount,
          address: depositAddress.address,
          addressId: depositAddress.tronAddressId,
          expiresAt: new Date(
            now.getTime() +
              this.config.getOrThrow<number>('DEPOSIT_WINDOW_MINUTES') * 60_000,
          ),
        }),
      );
    });
  }

  async findOwn(id: number, userId: string): Promise<AccountTransaction> {
    const row = await this.dataSource
      .getRepository(AccountTransaction)
      .findOne({
        where: { id, userId, type: AccountTransactionType.Deposit },
      });

    if (!row) throw new NotFoundException('Deposit not found');

    return row;
  }

  findById(id: number): Promise<AccountTransaction | null> {
    return this.dataSource.getRepository(AccountTransaction).findOne({
      where: { id, type: AccountTransactionType.Deposit },
    });
  }

  cancelOwn(id: number, userId: string): Promise<AccountTransaction> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(AccountTransaction, {
        where: { id, userId, type: AccountTransactionType.Deposit },
        lock: { mode: 'pessimistic_write' },
      });

      if (!row) throw new NotFoundException('Deposit not found');

      if (row.status !== AccountTransactionStatus.Pending) {
        throw new ConflictException(
          'Only a pending deposit request can be canceled',
        );
      }

      row.status = AccountTransactionStatus.Canceled;
      row.statusReason = AccountTransactionStatusReason.CanceledByUser;

      return manager.save(row);
    });
  }

  async expire(now: Date, limit: number): Promise<number> {
    const due = await this.dataSource.getRepository(AccountTransaction).find({
      where: {
        type: AccountTransactionType.Deposit,
        status: AccountTransactionStatus.Pending,
        expiresAt: LessThanOrEqual(now),
      },
      order: { expiresAt: 'ASC', id: 'ASC' },
      take: limit,
    });
    let expired = 0;

    for (const candidate of due) {
      const changed = await this.dataSource.transaction(async (manager) => {
        const row = await manager
          .getRepository(AccountTransaction)
          .createQueryBuilder('entry')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('entry.id = :id', { id: candidate.id })
          .andWhere('entry.status = :status', {
            status: AccountTransactionStatus.Pending,
          })
          .getOne();

        if (!row) return false;

        row.status = AccountTransactionStatus.Canceled;
        row.statusReason = AccountTransactionStatusReason.Expired;
        await manager.save(row);

        return true;
      });

      if (changed) expired += 1;
    }

    return expired;
  }

  async receive(
    manager: EntityManager,
    event: UsdtTransferEvent,
    tronAddress: TronAddress,
  ): Promise<void> {
    const owner = await manager.findOne(DepositAddress, {
      where: { tronAddressId: tronAddress.id },
    });

    if (!owner) return;

    const seen = await manager.count(DepositTransfer, {
      where: { txHash: event.txHash, logIndex: event.logIndex },
    });

    if (seen > 0) return;

    if (event.amount.lt(this.minimum())) {
      await this.accumulate(manager, owner, event);
      return;
    }

    const row =
      (await this.liveRequestFor(manager, owner.userId, event)) ??
      (await manager.save(
        manager.create(AccountTransaction, {
          type: AccountTransactionType.Deposit,
          status: AccountTransactionStatus.Processing,
          statusReason: null,
          userId: owner.userId,
          amount: null,
          address: owner.address,
          addressId: owner.tronAddressId,
        }),
      ));

    await this.attach(manager, row.id, event);
    await this.credit(manager, row, event.amount, null, event.txHash);
  }

  async verifyForCredit(
    id: number,
    txHash: string,
  ): Promise<DepositVerification> {
    const row = await this.findById(id);

    if (!row) throw new NotFoundException('Deposit not found');

    const inspection = await this.verifier.inspectUsdtTransfer(txHash);
    const toRow = inspection.transfers.filter(
      (transfer) => transfer.to === row.address,
    );
    const refusal = await this.refusalFor(row, inspection.status, toRow);

    return {
      inspection,
      creditable: refusal === null,
      amount:
        toRow.length > 0
          ? formatCrypto(this.sum(toRow.map((t) => t.amount)))
          : null,
      reason: refusal?.message ?? null,
    };
  }

  async creditManually(
    id: number,
    txHash: string,
    actorUserId: string,
  ): Promise<AccountTransaction> {
    const inspection = await this.verifier.inspectUsdtTransfer(txHash);

    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(AccountTransaction, {
        where: { id, type: AccountTransactionType.Deposit },
        lock: { mode: 'pessimistic_write' },
      });

      if (!row) throw new NotFoundException('Deposit not found');

      const toRow = inspection.transfers.filter(
        (transfer) => transfer.to === row.address,
      );
      const refusal = await this.refusalFor(
        row,
        inspection.status,
        toRow,
        manager,
      );

      if (refusal) throw refusal;

      for (const transfer of toRow)
        await this.attach(manager, row.id, transfer);

      const credited = await this.credit(
        manager,
        row,
        this.sum(toRow.map((t) => t.amount)),
        actorUserId,
        txHash,
      );
      await this.audit.record(
        {
          actorUserId,
          targetUserId: row.userId,
          action: 'deposit.credited_manually',
          metadata: { accountTransactionId: row.id, txHash },
        },
        manager,
      );

      return credited;
    });
  }

  async planCreditByHash(txHash: string): Promise<HashCreditPlan> {
    const inspection = await this.verifier.inspectUsdtTransfer(txHash);
    const statusRefusal = this.statusRefusal(inspection.status);

    if (statusRefusal)
      return { inspection, candidates: [], refusal: statusRefusal };

    const owners = await this.dataSource.getRepository(DepositAddress).find({
      where: {
        address: In([...new Set(inspection.transfers.map((t) => t.to))]),
      },
    });
    const candidates: HashCreditCandidate[] = [];

    for (const owner of owners) {
      const transfers = inspection.transfers.filter(
        (t) => t.to === owner.address,
      );
      const credited = await this.dataSource
        .getRepository(DepositTransfer)
        .count({
          where: transfers.map((t) => ({
            txHash: t.txHash,
            logIndex: t.logIndex,
          })),
        });
      candidates.push({
        userId: owner.userId,
        address: owner.address,
        addressId: owner.tronAddressId,
        transfers,
        alreadyCredited: credited > 0,
      });
    }

    const refusal =
      candidates.length === 0
        ? new BadRequestException(
            'The transfer did not go to any trader’s deposit address',
          )
        : candidates.every((candidate) => candidate.alreadyCredited)
          ? new ConflictException('This transfer is already credited')
          : null;

    return { inspection, candidates, refusal };
  }

  async creditByHash(
    txHash: string,
    actorUserId: string,
  ): Promise<AccountTransaction[]> {
    const plan = await this.planCreditByHash(txHash);

    if (plan.refusal) throw plan.refusal;

    return this.dataSource.transaction(async (manager) => {
      const credited: AccountTransaction[] = [];

      for (const candidate of plan.candidates) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `deposit_accumulation:${candidate.addressId}`,
        ]);
        const used = await manager.count(DepositTransfer, {
          where: candidate.transfers.map((t) => ({
            txHash: t.txHash,
            logIndex: t.logIndex,
          })),
        });

        if (used > 0) continue;

        const row = await manager.save(
          manager.create(AccountTransaction, {
            type: AccountTransactionType.Deposit,
            status: AccountTransactionStatus.Processing,
            statusReason: null,
            userId: candidate.userId,
            amount: null,
            address: candidate.address,
            addressId: candidate.addressId,
          }),
        );

        for (const transfer of candidate.transfers) {
          await this.attach(manager, row.id, transfer);
        }

        credited.push(
          await this.credit(
            manager,
            row,
            this.sum(candidate.transfers.map((t) => t.amount)),
            actorUserId,
            txHash,
          ),
        );
        await this.audit.record(
          {
            actorUserId,
            targetUserId: candidate.userId,
            action: 'deposit.credited_manually',
            metadata: { accountTransactionId: row.id, txHash },
          },
          manager,
        );
      }

      if (credited.length === 0) {
        throw new ConflictException('This transfer is already credited');
      }

      return credited;
    });
  }

  private statusRefusal(status: string): Error | null {
    if (status === 'not_found' || status === 'pending') {
      return new ConflictException('The transaction is not confirmed yet');
    }

    if (status === 'failed' || status === 'not_usdt') {
      return new BadRequestException(
        'The transaction is not a successful USDT transfer',
      );
    }

    return null;
  }

  private async refusalFor(
    row: AccountTransaction,
    status: string,
    toRow: UsdtTransferEvent[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Error | null> {
    const statusRefusal = this.statusRefusal(status);

    if (statusRefusal) return statusRefusal;

    if (toRow.length === 0) {
      return new BadRequestException(
        'The transfer did not go to this deposit address',
      );
    }

    if (!CREDITABLE_STATUSES.includes(row.status)) {
      return new ConflictException(
        row.status === AccountTransactionStatus.Completed
          ? 'The deposit is already credited'
          : 'Only a deposit that needs a check can be credited by hand',
      );
    }

    const used = await manager.count(DepositTransfer, {
      where: toRow.map((transfer) => ({
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
      })),
    });

    return used > 0
      ? new ConflictException('This transfer is already credited')
      : null;
  }

  private async accumulate(
    manager: EntityManager,
    owner: DepositAddress,
    event: UsdtTransferEvent,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `deposit_accumulation:${owner.tronAddressId}`,
    ]);
    const row =
      (await manager.findOne(AccountTransaction, {
        where: {
          type: AccountTransactionType.Deposit,
          addressId: owner.tronAddressId,
          status: AccountTransactionStatus.Processing,
          statusReason: AccountTransactionStatusReason.BelowMinimum,
        },
        lock: { mode: 'pessimistic_write' },
      })) ??
      (await manager.save(
        manager.create(AccountTransaction, {
          type: AccountTransactionType.Deposit,
          status: AccountTransactionStatus.Processing,
          statusReason: AccountTransactionStatusReason.BelowMinimum,
          userId: owner.userId,
          amount: null,
          address: owner.address,
          addressId: owner.tronAddressId,
        }),
      ));

    await this.attach(manager, row.id, event);
    const transfers = await manager.find(DepositTransfer, {
      where: { accountTransactionId: row.id },
    });
    const total = this.sum(transfers.map((transfer) => transfer.amount));
    row.amountReceived = total;

    if (total.lt(this.minimum())) {
      await manager.save(row);
      return;
    }

    row.statusReason = null;
    await this.credit(manager, row, total, null, null);
  }

  private async liveRequestFor(
    manager: EntityManager,
    userId: string,
    event: UsdtTransferEvent,
  ): Promise<AccountTransaction | null> {
    const live = await manager.find(AccountTransaction, {
      where: {
        type: AccountTransactionType.Deposit,
        userId,
        status: AccountTransactionStatus.Pending,
        expiresAt: MoreThan(event.blockTime),
      },
      order: { createdAt: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    return (
      live.find((row) => row.amount !== null && row.amount.eq(event.amount)) ??
      live[0] ??
      null
    );
  }

  private attach(
    manager: EntityManager,
    accountTransactionId: number,
    event: UsdtTransferEvent,
  ): Promise<DepositTransfer> {
    return manager.save(
      manager.create(DepositTransfer, {
        accountTransactionId,
        txHash: event.txHash,
        logIndex: event.logIndex,
        fromAddress: event.from,
        amount: event.amount,
        blockNumber: String(event.blockNumber),
        blockTime: event.blockTime,
      }),
    );
  }

  private async credit(
    manager: EntityManager,
    row: AccountTransaction,
    amount: Crypto,
    actorUserId: string | null,
    txHash: string | null,
  ): Promise<AccountTransaction> {
    row.status = AccountTransactionStatus.Completed;
    row.statusReason = null;
    row.amountReceived = amount;
    row.creditedAmount = amount;
    row.actorUserId = actorUserId;
    row.txHash = txHash ?? row.txHash;
    row.completedAt = new Date();
    const saved = await manager.save(row);

    await this.wallets.creditDepositWithin(manager, row.userId, amount, row.id);
    await this.audit.record(
      {
        actorUserId,
        targetUserId: row.userId,
        action: 'deposit.credited',
        metadata: {
          accountTransactionId: row.id,
          amount: formatCrypto(amount),
        },
      },
      manager,
    );
    await this.audit.record(
      {
        actorUserId,
        targetUserId: row.userId,
        action: ActivityAction.DepositCredited,
        metadata: {
          accountTransactionId: row.id,
          amount: formatCrypto(amount),
        },
      },
      manager,
    );

    return saved;
  }

  private sum(amounts: Crypto[]): Crypto {
    return roundCrypto(
      amounts.reduce((total, amount) => total.plus(amount), toDecimal(0)),
    );
  }

  private minimum(): Crypto {
    return toCrypto(this.config.getOrThrow<string>('DEPOSIT_MIN_USDT'));
  }
}
