import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { BalanceOperation } from '../entities/balance-operation.entity';
import { MethodRate } from '../entities/method-rate.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { Wallet } from '../entities/wallet.entity';
import { RateService } from '../services/rate.service';
import { TransactionService } from '../services/transaction.service';
import { WalletService } from '../services/wallet.service';
import { TransactionsModule } from '../transactions.module';

describe('the transactions module graph', () => {
  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const dataSource = {
    transaction: jest.fn(),
    manager: {},
  };

  @Global()
  @Module({
    providers: [{ provide: getDataSourceToken(), useValue: dataSource }],
    exports: [getDataSourceToken()],
  })
  class FakeDataSourceModule {}

  const compile = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FakeDataSourceModule,
        TransactionsModule,
      ],
    })
      .overrideProvider(getRepositoryToken(Transaction))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(TransactionStatusEvent))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(Wallet))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(BalanceOperation))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MethodRate))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(TraderSettings))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(repository)
      .overrideProvider(ConfigService)
      .useValue({ get: jest.fn(() => 0) })
      .compile();

  it('resolves every provider it wires', async () => {
    await expect(compile()).resolves.toBeDefined();
  });

  it('exposes the rate, wallet and transaction services', async () => {
    const module = await compile();

    expect(module.get(RateService)).toBeInstanceOf(RateService);
    expect(module.get(WalletService)).toBeInstanceOf(WalletService);
    expect(module.get(TransactionService)).toBeInstanceOf(TransactionService);
  });
});
