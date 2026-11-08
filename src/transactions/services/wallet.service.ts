import Decimal from 'decimal.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Crypto } from '../../common/types/crypto';
import { Page, toPage } from '../../common/types/page';
import { roundCrypto } from '../../common/utils/round-crypto';
import { sortDirection } from '../../common/utils/sort-direction';
import { toCrypto } from '../../common/utils/to-crypto';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { BalanceOperation } from '../entities/balance-operation.entity';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { Transaction } from '../entities/transaction.entity';
import { Wallet } from '../entities/wallet.entity';
import { BalanceOperationFilter } from '../types/balance-operation-filter';
import { BalanceOperationListQuery } from '../types/balance-operation-list-query';
import { balanceOperationWhere } from '../utils/balance-operation-where';
import { BalanceKind } from '../types/balance-kind.enum';
import { BalanceOperationType } from '../types/balance-operation-type.enum';
import { DisputeStatus } from '../types/dispute-status.enum';
import { OwnBalanceMove } from '../types/own-balance-move';
import { TransactionKind } from '../types/transaction-kind.enum';
import { canWithdrawInsurance } from '../utils/can-withdraw-insurance';
import { isNightWindow } from '../utils/is-night-window';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private readonly wallets: Repository<Wallet>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly traderSettings: TraderSettingsService,
  ) {}

  findByUserId(userId: string): Promise<Wallet | null> {
    return this.wallets.findOne({ where: { userId } });
  }

  async findByUserIds(userIds: string[]): Promise<Wallet[]> {
    if (userIds.length === 0) return [];

    return this.wallets.find({ where: { userId: In(userIds) } });
  }

  async listOperations(
    query: BalanceOperationListQuery,
  ): Promise<Page<BalanceOperation>> {
    const wallet = await this.findByUserId(query.userId);

    if (!wallet) return toPage([[], 0], query);

    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.dataSource.getRepository(BalanceOperation).findAndCount({
        where: balanceOperationWhere(wallet.id, query),
        order: { createdAt: direction, id: direction },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async exportOperations(
    filter: BalanceOperationFilter,
    maxRows: number,
  ): Promise<BalanceOperation[]> {
    const wallet = await this.findByUserId(filter.userId);

    if (!wallet) return [];

    const rows = await this.dataSource.getRepository(BalanceOperation).find({
      where: balanceOperationWhere(wallet.id, filter),
      order: { createdAt: 'DESC', id: 'DESC' },
      take: maxRows + 1,
    });

    if (rows.length > maxRows) {
      throw new BadRequestException(
        `More than ${maxRows} operations match; narrow the period or the filters`,
      );
    }

    return rows;
  }

  async ensureWallet(userId: string): Promise<Wallet> {
    const existing = await this.wallets.findOne({ where: { userId } });
    if (existing) return existing;

    return this.wallets.save(this.wallets.create({ userId }));
  }

  getAvailableMain(wallet: Wallet): Crypto {
    return roundCrypto(wallet.mainBalance.minus(wallet.mainReserved));
  }

  async isTradingEnabled(userId: string): Promise<boolean> {
    return this.hasTradingBalance(await this.requireWallet(userId));
  }

  async assertMayEnableTradingWithin(
    manager: EntityManager,
    userId: string,
    settings: TraderSettings,
  ): Promise<void> {
    const wallet = await manager.findOne(Wallet, {
      where: { userId },
      lock: { mode: 'pessimistic_read' },
    });
    const insurance = wallet?.insurancePayInBalance ?? toCrypto(0);

    if (insurance.lt(this.traderSettings.insurancePayInMinOf(settings))) {
      throw new ConflictException({
        statusCode: 409,
        code: 'INSURANCE_BELOW_MINIMUM',
        message: 'The pay-in insurance is below its minimum',
      });
    }

    if (!wallet || !this.hasTradingBalance(wallet)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'BALANCE_BELOW_THRESHOLD',
        message: 'The available balance is below the trading threshold',
      });
    }
  }

  async stampAcceptedDealWithin(
    manager: EntityManager,
    userId: string,
    acceptedAt: Date,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(Wallet)
      .set({
        lastAcceptedDealAt: () =>
          'GREATEST(COALESCE("lastAcceptedDealAt", :acceptedAt), :acceptedAt)',
      })
      .where('"userId" = :userId', { userId })
      .setParameter('acceptedAt', acceptedAt)
      .execute();
  }

  isWithinNightWindow(now: Date): boolean {
    return isNightWindow(
      now,
      this.config.get<number>('INSURANCE_NIGHT_START_HOUR', 0),
      this.config.get<number>('INSURANCE_NIGHT_END_HOUR', 10),
      this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
    );
  }

  async canWithdrawInsurancePayIn(userId: string, now: Date): Promise<boolean> {
    const wallet = await this.requireWallet(userId);
    const delayDays = this.config.get<number>(
      'INSURANCE_WITHDRAWAL_DELAY_DAYS',
      14,
    );

    return canWithdrawInsurance(
      wallet.lastAcceptedDealAt ?? null,
      now,
      delayDays,
    );
  }

  async reserveMainEscrowWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
  ): Promise<void> {
    const wallet = await this.lock(manager, userId);
    if (this.getAvailableMain(wallet).lt(amount)) {
      throw new ConflictException('Insufficient available balance');
    }

    wallet.mainReserved = roundCrypto(wallet.mainReserved.plus(amount));
    await manager.save(wallet);
  }

  async lockWalletsWithin(
    manager: EntityManager,
    userIds: string[],
    createMissingFor: string[],
  ): Promise<Wallet[]> {
    const missing = [...new Set(createMissingFor)].sort();

    if (missing.length) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(Wallet)
        .values(missing.map((userId) => ({ userId })))
        .orIgnore()
        .execute();
    }

    const locked: Wallet[] = [];
    for (const userId of [...new Set(userIds)].sort()) {
      locked.push(await this.lock(manager, userId));
    }

    return locked;
  }

  async debitMainWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<void> {
    const wallet = await this.lock(manager, userId);
    const operation = this.journalMove(
      manager,
      wallet,
      BalanceKind.Main,
      amount.neg(),
      BalanceOperationType.Transaction,
      transactionId,
    );
    wallet.mainReserved = roundCrypto(wallet.mainReserved.minus(amount));
    await manager.save(wallet);
    await manager.save(operation);
  }

  async creditMainWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<void> {
    const wallet = await this.lock(manager, userId);
    const operation = this.journalMove(
      manager,
      wallet,
      BalanceKind.Main,
      amount,
      BalanceOperationType.Transaction,
      transactionId,
    );
    await manager.save(wallet);
    await manager.save(operation);
  }

  async creditLeadShareWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(Wallet)
      .values({ userId })
      .orIgnore()
      .execute();
    await this.creditMainWithin(manager, userId, amount, transactionId);
  }

  async creditDebtWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
  ): Promise<BalanceOperation> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(Wallet)
      .values({ userId })
      .orIgnore()
      .execute();

    return this.moveMainWithin(
      manager,
      userId,
      amount,
      BalanceOperationType.DebtIssued,
    );
  }

  debitDebtWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
  ): Promise<BalanceOperation> {
    return this.moveMainWithin(
      manager,
      userId,
      amount.neg(),
      BalanceOperationType.DebtWriteOff,
    );
  }

  async releaseEscrowWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
  ): Promise<void> {
    const wallet = await this.lock(manager, userId);
    wallet.mainReserved = roundCrypto(wallet.mainReserved.minus(amount));
    await manager.save(wallet);
  }

  async applyDisputeLossWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<void> {
    if (!amount.gt(0)) return;

    const wallet = await this.lock(manager, userId);
    const fromMain = roundCrypto(
      Decimal.min(amount, Decimal.max(wallet.mainBalance, 0)),
    );
    const left = amount.minus(fromMain);
    const fromInsurance = roundCrypto(
      Decimal.min(left, Decimal.max(wallet.insurancePayInBalance, 0)),
    );
    const belowZero = roundCrypto(left.minus(fromInsurance));
    const operations = [
      ...(fromMain.gt(0) || belowZero.gt(0)
        ? [
            this.journalMove(
              manager,
              wallet,
              BalanceKind.Main,
              fromMain.plus(belowZero).neg(),
              BalanceOperationType.Transaction,
              transactionId,
            ),
          ]
        : []),
      ...(fromInsurance.gt(0)
        ? [
            this.journalMove(
              manager,
              wallet,
              BalanceKind.InsurancePayIn,
              fromInsurance.neg(),
              BalanceOperationType.Transaction,
              transactionId,
            ),
          ]
        : []),
    ];

    await manager.save(wallet);
    await manager.save(operations);
  }

  async debitLeadShareWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<void> {
    const wallet = await this.lock(manager, userId);
    const operation = this.journalMove(
      manager,
      wallet,
      BalanceKind.Main,
      amount.neg(),
      BalanceOperationType.Transaction,
      transactionId,
    );

    await manager.save(wallet);
    await manager.save(operation);
  }

  async transferWithin(
    manager: EntityManager,
    fromUserId: string,
    toUserId: string,
    amount: Crypto,
    accountTransactionId: number,
  ): Promise<void> {
    if (fromUserId === toUserId) {
      throw new ConflictException('Cannot transfer to the same wallet');
    }

    const [first, second] = await this.lockWalletsWithin(
      manager,
      [fromUserId, toUserId],
      [toUserId],
    );
    const from = first.userId === fromUserId ? first : second;
    const to = first.userId === fromUserId ? second : first;

    if (this.getAvailableMain(from).lt(amount)) {
      throw new ConflictException('Insufficient available balance');
    }

    const debit = this.journalMove(
      manager,
      from,
      BalanceKind.Main,
      amount.neg(),
      BalanceOperationType.Internal,
      null,
    );
    const credit = this.journalMove(
      manager,
      to,
      BalanceKind.Main,
      amount,
      BalanceOperationType.Internal,
      null,
    );
    debit.accountTransactionId = accountTransactionId;
    credit.accountTransactionId = accountTransactionId;

    await manager.save([from, to]);
    await manager.save([debit, credit]);
  }

  async moveBetweenOwnBalancesWithin(
    manager: EntityManager,
    move: OwnBalanceMove,
  ): Promise<void> {
    const [wallet] = await this.lockWalletsWithin(
      manager,
      [move.userId],
      [move.userId],
    );

    if (move.from !== BalanceKind.Main && move.insuranceDelayCheckedAt) {
      await this.assertNoLiveDisputeWithin(manager, move.userId);
      await this.assertInsuranceDelayOverWithin(
        manager,
        wallet,
        move.insuranceDelayCheckedAt,
      );
    }

    if (this.availableOf(wallet, move.from).lt(move.amount)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient available balance',
      });
    }

    const debit = this.journalMove(
      manager,
      wallet,
      move.from,
      move.amount.neg(),
      BalanceOperationType.Internal,
      null,
    );
    const credit = this.journalMove(
      manager,
      wallet,
      move.to,
      move.amount,
      BalanceOperationType.Internal,
      null,
    );
    debit.accountTransactionId = move.accountTransactionId;
    credit.accountTransactionId = move.accountTransactionId;

    await manager.save(wallet);
    await manager.save([debit, credit]);
  }

  async creditDepositWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
    accountTransactionId: number,
  ): Promise<BalanceOperation> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(Wallet)
      .values({ userId })
      .orIgnore()
      .execute();

    return this.moveMainWithin(
      manager,
      userId,
      amount,
      BalanceOperationType.Deposit,
      accountTransactionId,
    );
  }

  async settleWithdrawalWithin(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
    fee: Crypto,
    accountTransactionId: number,
  ): Promise<void> {
    const wallet = await this.lock(manager, userId);
    wallet.mainReserved = roundCrypto(
      wallet.mainReserved.minus(amount).minus(fee),
    );
    const operations = [
      this.journalMove(
        manager,
        wallet,
        BalanceKind.Main,
        amount.neg(),
        BalanceOperationType.Withdrawal,
        null,
      ),
      ...(fee.gt(0)
        ? [
            this.journalMove(
              manager,
              wallet,
              BalanceKind.Main,
              fee.neg(),
              BalanceOperationType.WithdrawalFee,
              null,
            ),
          ]
        : []),
    ];

    for (const operation of operations) {
      operation.accountTransactionId = accountTransactionId;
    }

    await manager.save(wallet);
    await manager.save(operations);
  }

  private async moveMainWithin(
    manager: EntityManager,
    userId: string,
    delta: Decimal,
    type: BalanceOperationType,
    accountTransactionId: number | null = null,
  ): Promise<BalanceOperation> {
    const wallet = await this.lock(manager, userId);
    const operation = this.journalMove(
      manager,
      wallet,
      BalanceKind.Main,
      delta,
      type,
      null,
    );
    operation.accountTransactionId = accountTransactionId;
    await manager.save(wallet);

    return manager.save(operation);
  }

  hasTradingBalance(wallet: Wallet): boolean {
    return this.getAvailableMain(wallet).gt(
      toCrypto(this.config.get<string>('MAIN_BALANCE_MIN_THRESHOLD', '0')),
    );
  }

  private async assertNoLiveDisputeWithin(
    manager: EntityManager,
    traderUserId: string,
  ): Promise<void> {
    const live = await manager.exists(TransactionDispute, {
      where: {
        status: In([DisputeStatus.Open, DisputeStatus.Reviewing]),
        transaction: { traderUserId },
      },
    });

    if (live) {
      throw new ConflictException({
        statusCode: 409,
        code: 'INSURANCE_LOCKED_BY_DISPUTE',
        message:
          'The insurance cannot be moved while one of your disputes is open or under review',
      });
    }
  }

  private async assertInsuranceDelayOverWithin(
    manager: EntityManager,
    wallet: Wallet,
    now: Date,
  ): Promise<void> {
    const lastAcceptedDealAt =
      wallet.lastAcceptedDealAt ??
      (await this.latestAssignedDealAtWithin(manager, wallet.userId));
    const delayDays = this.config.get<number>(
      'INSURANCE_WITHDRAWAL_DELAY_DAYS',
      14,
    );

    if (
      lastAcceptedDealAt === null ||
      canWithdrawInsurance(lastAcceptedDealAt, now, delayDays)
    ) {
      return;
    }

    throw new ConflictException({
      statusCode: 409,
      code: 'INSURANCE_WITHDRAWAL_DELAYED',
      message: `The insurance can be moved ${delayDays} days after the last accepted deal`,
      availableAt: new Date(
        lastAcceptedDealAt.getTime() + delayDays * DAY_MS,
      ).toISOString(),
    });
  }

  private async latestAssignedDealAtWithin(
    manager: EntityManager,
    traderUserId: string,
  ): Promise<Date | null> {
    const row = await manager
      .createQueryBuilder(Transaction, 'deal')
      .select(
        `MAX(CASE WHEN deal.kind = :payOut THEN COALESCE(deal."payoutTakenAt", deal."createdAt") ELSE deal."createdAt" END)`,
        'at',
      )
      .where('deal."traderUserId" = :traderUserId', { traderUserId })
      .setParameter('payOut', TransactionKind.PayOut)
      .getRawOne<{ at: Date | string | null }>();

    return row?.at ? new Date(row.at) : null;
  }

  private availableOf(wallet: Wallet, kind: BalanceKind): Crypto {
    switch (kind) {
      case BalanceKind.Main:
        return this.getAvailableMain(wallet);
      case BalanceKind.InsurancePayIn:
        return roundCrypto(
          wallet.insurancePayInBalance.minus(wallet.insurancePayInReserved),
        );
      case BalanceKind.InsurancePayOut:
        return roundCrypto(
          wallet.insurancePayOutBalance.minus(wallet.insurancePayOutReserved),
        );
    }
  }

  private async requireWallet(userId: string): Promise<Wallet> {
    const wallet = await this.wallets.findOne({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    return wallet;
  }

  private async lock(manager: EntityManager, userId: string): Promise<Wallet> {
    const wallet = await manager.findOne(Wallet, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    return wallet;
  }

  private journalMove(
    manager: EntityManager,
    wallet: Wallet,
    kind: BalanceKind,
    delta: Decimal,
    type: BalanceOperationType,
    transactionId: string | null,
  ): BalanceOperation {
    const before = this.readBalance(wallet, kind);
    const after = roundCrypto(before.plus(delta));
    this.writeBalance(wallet, kind, after);

    return manager.create(BalanceOperation, {
      walletId: wallet.id,
      type,
      balanceKind: kind,
      transactionId,
      amount: roundCrypto(delta),
      balanceBefore: before,
      balanceAfter: after,
    });
  }

  private readBalance(wallet: Wallet, kind: BalanceKind): Crypto {
    switch (kind) {
      case BalanceKind.Main:
        return wallet.mainBalance;
      case BalanceKind.InsurancePayIn:
        return wallet.insurancePayInBalance;
      case BalanceKind.InsurancePayOut:
        return wallet.insurancePayOutBalance;
    }
  }

  private writeBalance(wallet: Wallet, kind: BalanceKind, value: Crypto): void {
    switch (kind) {
      case BalanceKind.Main:
        wallet.mainBalance = value;
        return;
      case BalanceKind.InsurancePayIn:
        wallet.insurancePayInBalance = value;
        return;
      case BalanceKind.InsurancePayOut:
        wallet.insurancePayOutBalance = value;
        return;
    }
  }
}
