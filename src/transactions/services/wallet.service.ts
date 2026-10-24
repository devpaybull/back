import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { BalanceOperation } from '../entities/balance-operation.entity';
import { Wallet } from '../entities/wallet.entity';
import { BalanceKind } from '../types/balance-kind.enum';
import { BalanceOperationType } from '../types/balance-operation-type.enum';
import { canWithdrawInsurance } from '../utils/can-withdraw-insurance';
import { isNightWindow } from '../utils/is-night-window';
import { roundMoney } from '../utils/round-money';

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

  async ensureWallet(userId: string): Promise<Wallet> {
    const existing = await this.wallets.findOne({ where: { userId } });
    if (existing) return existing;

    return this.wallets.save(this.wallets.create({ userId }));
  }

  getAvailableMain(wallet: Wallet): number {
    return roundMoney(wallet.mainBalance - wallet.mainReserved);
  }

  async isTradingEnabled(userId: string): Promise<boolean> {
    const wallet = await this.requireWallet(userId);
    const threshold = this.config.get<number>('MAIN_BALANCE_MIN_THRESHOLD', 0);

    return this.getAvailableMain(wallet) > threshold;
  }

  async hasMinInsurancePayIn(userId: string): Promise<boolean> {
    const wallet = await this.requireWallet(userId);
    const minimum =
      await this.traderSettings.effectiveInsurancePayInMin(userId);

    return wallet.insurancePayInBalance >= minimum;
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

  async reserveMainEscrow(userId: string, amount: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const wallet = await this.lock(manager, userId);
      if (this.getAvailableMain(wallet) < amount) {
        throw new ConflictException('Insufficient available balance');
      }

      wallet.mainReserved = roundMoney(wallet.mainReserved + amount);
      await manager.save(wallet);
    });
  }

  async releaseMainEscrow(userId: string, amount: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const wallet = await this.lock(manager, userId);
      wallet.mainReserved = roundMoney(wallet.mainReserved - amount);
      await manager.save(wallet);
    });
  }

  async debitMainWithin(
    manager: EntityManager,
    userId: string,
    amount: number,
    transactionId: string,
  ): Promise<void> {
    const wallet = await this.lock(manager, userId);
    const operation = this.journalMove(
      manager,
      wallet,
      BalanceKind.Main,
      -amount,
      BalanceOperationType.Transaction,
      transactionId,
    );
    wallet.mainReserved = roundMoney(wallet.mainReserved - amount);
    await manager.save(wallet);
    await manager.save(operation);
  }

  async creditMainWithin(
    manager: EntityManager,
    userId: string,
    amount: number,
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

  async releaseEscrowWithin(
    manager: EntityManager,
    userId: string,
    amount: number,
  ): Promise<void> {
    const wallet = await this.lock(manager, userId);
    wallet.mainReserved = roundMoney(wallet.mainReserved - amount);
    await manager.save(wallet);
  }

  async applyDisputeLoss(
    userId: string,
    amount: number,
    transactionId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const wallet = await this.lock(manager, userId);
      const operations: BalanceOperation[] = [];

      const fromMain = Math.min(amount, Math.max(wallet.mainBalance, 0));
      if (fromMain > 0) {
        operations.push(
          this.journalMove(
            manager,
            wallet,
            BalanceKind.Main,
            -fromMain,
            BalanceOperationType.Transaction,
            transactionId,
          ),
        );
      }

      const remainder = roundMoney(amount - fromMain);
      if (remainder > 0) {
        operations.push(
          this.journalMove(
            manager,
            wallet,
            BalanceKind.InsurancePayIn,
            -remainder,
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
    amount: number,
    transactionId: string,
  ): Promise<void> {
    if (fromUserId === toUserId) {
      throw new ConflictException('Cannot transfer to the same wallet');
    }

    const [firstId, secondId] = [fromUserId, toUserId].sort();
    const first = await this.lock(manager, firstId);
    const second = await this.lock(manager, secondId);
    const from = first.userId === fromUserId ? first : second;
    const to = first.userId === fromUserId ? second : first;

    if (this.getAvailableMain(from) < amount) {
      throw new ConflictException('Insufficient available balance');
    }

    const debit = this.journalMove(
      manager,
      from,
      BalanceKind.Main,
      -amount,
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
    delta: number,
    type: BalanceOperationType,
    transactionId: string | null,
  ): BalanceOperation {
    const before = this.readBalance(wallet, kind);
    const after = roundMoney(before + delta);
    this.writeBalance(wallet, kind, after);

    return manager.create(BalanceOperation, {
      walletId: wallet.id,
      type,
      balanceKind: kind,
      transactionId,
      amount: roundMoney(delta),
      balanceBefore: before,
      balanceAfter: after,
    });
  }

  private readBalance(wallet: Wallet, kind: BalanceKind): number {
    switch (kind) {
      case BalanceKind.Main:
        return wallet.mainBalance;
      case BalanceKind.InsurancePayIn:
        return wallet.insurancePayInBalance;
      case BalanceKind.InsurancePayOut:
        return wallet.insurancePayOutBalance;
    }
  }

  private writeBalance(wallet: Wallet, kind: BalanceKind, value: number): void {
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
