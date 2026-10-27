import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AuditInstallation } from '../../audit/entities/audit-installation.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { Bank } from '../../banks/entities/bank.entity';
import { Country } from '../../countries/entities/country.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { MerchantApiKey } from '../../merchants/entities/merchant-api-key.entity';
import { MerchantAttachmentMethod } from '../../merchants/entities/merchant-attachment-method.entity';
import { MerchantAttachment } from '../../merchants/entities/merchant-attachment.entity';
import { MerchantCurrency } from '../../merchants/entities/merchant-currency.entity';
import { MerchantGroup } from '../../merchants/entities/merchant-group.entity';
import { MerchantIpAddress } from '../../merchants/entities/merchant-ip-address.entity';
import { MerchantMethod } from '../../merchants/entities/merchant-method.entity';
import { MerchantSettings } from '../../merchants/entities/merchant-settings.entity';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { EmailVerification } from '../../users/entities/email-verification.entity';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { UserBackupCode } from '../../users/entities/user-backup-code.entity';
import { User } from '../../users/entities/user.entity';
import { UserTeamService } from '../../users/services/user-team.service';
import { BalanceOperation } from '../entities/balance-operation.entity';
import { LeadRate } from '../entities/lead-rate.entity';
import { MerchantBalanceOperation } from '../entities/merchant-balance-operation.entity';
import { MerchantBalance } from '../entities/merchant-balance.entity';
import { MethodRate } from '../entities/method-rate.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
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
      .overrideProvider(getRepositoryToken(LeadRate))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(TransactionLeadShare))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantBalance))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantBalanceOperation))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(User))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(UserBackupCode))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(EmailVerification))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(TraderLead))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(TraderSettings))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(AuditInstallation))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(Bank))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(Country))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(Currency))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(Merchant))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantApiKey))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantGroup))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantMethod))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantAttachment))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantAttachmentMethod))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantSettings))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantCurrency))
      .useValue(repository)
      .overrideProvider(getRepositoryToken(MerchantIpAddress))
      .useValue(repository)
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string) => (key === 'VICTORIA_LOGS_URL' ? '' : 0)),
      })
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

  it('reaches the lead assignments through the users module, which owns them', async () => {
    const module = await compile();

    expect(module.get(UserTeamService, { strict: false })).toBeInstanceOf(
      UserTeamService,
    );
  });

  it('reads the merchant’s overdraft switch through the merchants module, which owns it', async () => {
    const module = await compile();

    expect(
      module.get(MerchantSettingsService, { strict: false }),
    ).toBeInstanceOf(MerchantSettingsService);
  });
});
