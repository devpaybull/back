import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ActivityRead } from '../../audit/entities/activity-read.entity';
import { AuditInstallation } from '../../audit/entities/audit-installation.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { BankDetailTag } from '../../bank-details/entities/bank-detail-tag.entity';
import { BankDetailTagLink } from '../../bank-details/entities/bank-detail-tag-link.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionStatusEvent } from '../../transactions/entities/transaction-status-event.entity';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { FileStorage } from '../../file-storage/types/file-storage';
import { PayoutDecline } from '../../transactions/entities/payout-decline.entity';
import { SelectionAttempt } from '../../transactions/entities/selection-attempt.entity';
import { TransactionDispute } from '../../transactions/entities/transaction-dispute.entity';
import { TransactionFile } from '../../transactions/entities/transaction-file.entity';
import { BalanceOperation } from '../../transactions/entities/balance-operation.entity';
import { MethodRate } from '../../transactions/entities/method-rate.entity';
import { LeadRate } from '../../transactions/entities/lead-rate.entity';
import { TransactionLeadShare } from '../../transactions/entities/transaction-lead-share.entity';
import { MerchantBalance } from '../../transactions/entities/merchant-balance.entity';
import { MerchantBalanceOperation } from '../../transactions/entities/merchant-balance-operation.entity';
import { User } from '../../users/entities/user.entity';
import { UserBackupCode } from '../../users/entities/user-backup-code.entity';
import { EmailVerification } from '../../users/entities/email-verification.entity';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { MerchantApiKey } from '../../merchants/entities/merchant-api-key.entity';
import { MerchantGroup } from '../../merchants/entities/merchant-group.entity';
import { MerchantMethod } from '../../merchants/entities/merchant-method.entity';
import { MerchantAttachment } from '../../merchants/entities/merchant-attachment.entity';
import { MerchantAttachmentMethod } from '../../merchants/entities/merchant-attachment-method.entity';
import { MerchantSettings } from '../../merchants/entities/merchant-settings.entity';
import { MerchantCurrency } from '../../merchants/entities/merchant-currency.entity';
import { MerchantIpAddress } from '../../merchants/entities/merchant-ip-address.entity';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { Bank } from '../../banks/entities/bank.entity';
import { CounterpartyDailyVolume } from '../../counterparties/entities/counterparty-daily-volume.entity';
import { CounterpartyRequisiteEvent } from '../../counterparties/entities/counterparty-requisite-event.entity';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
import { Country } from '../../countries/entities/country.entity';
import { Currency } from '../../currencies/entities/currency.entity';
import { MobileOperator } from '../../mobile-operators/entities/mobile-operator.entity';
import { BankDetailsController } from '../../bank-details/bank-details.controller';
import { DevicesController } from '../controllers/devices.controller';
import { DevicesModule } from '../devices.module';
import { DevicesService } from '../devices.service';
import { DeviceCredential } from '../entities/device-credential.entity';
import { DevicePairing } from '../entities/device-pairing.entity';
import { Device } from '../entities/device.entity';

describe('the devices ↔ bank-details module graph', () => {
  const repository = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    merge: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };

  const dataSource = { transaction: jest.fn(), manager: {} };

  @Global()
  @Module({
    providers: [{ provide: getDataSourceToken(), useValue: dataSource }],
    exports: [getDataSourceToken()],
  })
  class FakeDataSourceModule {}

  const entities = [
    Device,
    DevicePairing,
    DeviceCredential,
    BankDetails,
    AuditLog,
    AuditInstallation,
    ActivityRead,
    Bank,
    Country,
    Currency,
    MobileOperator,
    Counterparty,
    CounterpartyDailyVolume,
    CounterpartyRequisiteEvent,
    BankDetailTag,
    BankDetailTagLink,
    Transaction,
    TransactionStatusEvent,
    Wallet,
    BalanceOperation,
    MethodRate,
    LeadRate,
    TransactionLeadShare,
    MerchantBalance,
    MerchantBalanceOperation,
    User,
    UserBackupCode,
    EmailVerification,
    TraderLead,
    TraderSettings,
    Merchant,
    MerchantApiKey,
    MerchantGroup,
    MerchantMethod,
    MerchantAttachment,
    MerchantAttachmentMethod,
    MerchantSettings,
    MerchantCurrency,
    MerchantIpAddress,
    SelectionAttempt,
    TransactionFile,
    PayoutDecline,
    TransactionDispute,
  ];

  const compile = () => {
    let builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FakeDataSourceModule,
        DevicesModule,
      ],
    });

    for (const entity of entities) {
      builder = builder
        .overrideProvider(getRepositoryToken(entity))
        .useValue(repository);
    }

    return builder
      .overrideProvider(FileStorage)
      .useValue({})
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string) =>
          key === 'VICTORIA_LOGS_URL' ? '' : 5000,
        ),
      })
      .compile();
  };

  it('resolves despite the cycle the two forwardRefs describe', async () => {
    await expect(compile()).resolves.toBeDefined();
  });

  it('gives the devices controller the bank-details service it deletes through', async () => {
    const module = await compile();

    expect(module.get(DevicesController)).toBeInstanceOf(DevicesController);
    expect(module.get(BankDetailsService)).toBeInstanceOf(BankDetailsService);
  });

  it('gives the bank-details controller its own service back', async () => {
    const module = await compile();

    expect(module.get(BankDetailsController, { strict: false })).toBeInstanceOf(
      BankDetailsController,
    );
    expect(module.get(DevicesService)).toBeInstanceOf(DevicesService);
  });
});
