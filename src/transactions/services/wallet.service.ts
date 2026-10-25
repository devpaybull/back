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
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { BalanceOperation } from '../entities/balance-operation.entity';
import { Wallet } from '../entities/wallet.entity';
import { BalanceOperationFilter } from '../types/balance-operation-filter';
import { BalanceOperationListQuery } from '../types/balance-operation-list-query';
import { balanceOperationWhere } from '../utils/balance-operation-where';
import { BalanceKind } from '../types/balance-kind.enum';
import { BalanceOperationType } from '../types/balance-operation-type.enum';
import { canWithdrawInsurance } from '../utils/can-withdraw-insurance';
import { isNightWindow } from '../utils/is-night-window';

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
    const wallet = await this.requireWallet(userId);
    const threshold = toCrypto(
      this.config.get<string>('MAIN_BALANCE_MIN_THRESHOLD', '0'),
    );

    return this.getAvailableMain(wallet).gt(threshold);
  }

  async hasMinInsurancePayIn(userId: string): Promise<boolean> {
    const wallet = await this.requireWallet(userId);
    const minimum =
      await this.traderSettings.effectiveInsurancePayInMin(userId);

    return wallet.insurancePayInBalance.gte(minimum);
  }

  isWithinNightWindow(now: Date): boolean {
    return isNightWindow(
      now,
      this.config.get<number>('INSURANCE_NIGHT_START_HOUR', 0),
      this.config.get<number>('INSURANCE_NIGHT_END_HOUR', 10),
      this.config.get<string>('INSURANCE_NIGHT_TIMEZONE', 'Europe/Moscow'),
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

  async applyDisputeLoss(
    userId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const wallet = await this.lock(manager, userId);
      const operations: BalanceOperation[] = [];

      const fromMain = toCrypto(
        Decimal.min(amount, Decimal.max(wallet.mainBalance, 0)),
      );
      if (fromMain.gt(0)) {
        operations.push(
          this.journalMove(
            manager,
            wallet,
            BalanceKind.Main,
            fromMain.neg(),
            BalanceOperationType.Transaction,
            transactionId,
          ),
        );
      }

      const remainder = roundCrypto(amount.minus(fromMain));
      if (remainder.gt(0)) {
        operations.push(
          this.journalMove(
            manager,
            wallet,
            BalanceKind.InsurancePayIn,
            remainder.neg(),
            BalanceOperationType.Transaction,
            transactionId,
          ),
        );
      }

      await manager.save(wallet);
      await manager.save(operations);
    });
  }

  async transferWithin(
    manager: EntityManager,
    fromUserId: string,
    toUserId: string,
    amount: Crypto,
    transactionId: string,
  ): Promise<void> {
    if (fromUserId === toUserId) {
      throw new ConflictException('Cannot transfer to the same wallet');
    }

    const [first, second] = await this.lockWalletsWithin(
      manager,
      [fromUserId, toUserId],
      [],
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
      transactionId,
    );
    const credit = this.journalMove(
      manager,
      to,
      BalanceKind.Main,
      amount,
      BalanceOperationType.Internal,
      transactionId,
    );

    await manager.save([from, to]);
    await manager.save([debit, credit]);
  }

  private async moveMainWithin(
    manager: EntityManager,
    userId: string,
    delta: Decimal,
    type: BalanceOperationType,
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
    await manager.save(wallet);

    return manager.save(operation);
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
