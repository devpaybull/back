import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ActivityRead } from '../../audit/entities/activity-read.entity';
import { AuditInstallation } from '../../audit/entities/audit-installation.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { Bank } from '../../banks/entities/bank.entity';
import { CounterpartyDailyRequest } from '../../counterparties/entities/counterparty-daily-request.entity';
import { CounterpartyDailyVolume } from '../../counterparties/entities/counterparty-daily-volume.entity';
import { MerchantApiRequest } from '../../merchant-requests/entities/merchant-api-request.entity';
import { CounterpartyRequisiteEvent } from '../../counterparties/entities/counterparty-requisite-event.entity';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
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
import { NotificationSetting } from '../../trader-settings/entities/notification-setting.entity';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { BalanceOperation } from '../../transactions/entities/balance-operation.entity';
import { LeadRate } from '../../transactions/entities/lead-rate.entity';
import { MethodRate } from '../../transactions/entities/method-rate.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { MerchantBalanceOperation } from '../../transactions/entities/merchant-balance-operation.entity';
import { MerchantBalance } from '../../transactions/entities/merchant-balance.entity';
import { TransactionLeadShare } from '../../transactions/entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from '../../transactions/entities/transaction-status-event.entity';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { TronAddress } from '../../tron/entities/tron-address.entity';
import { TronOutgoingTransfer } from '../../tron/entities/tron-outgoing-transfer.entity';
import { TronScanCursor } from '../../tron/entities/tron-scan-cursor.entity';
import { TronConfirmationTracker } from '../../tron/services/tron-confirmation-tracker.service';
import { UsdtTransferScanner } from '../../tron/services/usdt-transfer-scanner.service';
import { AddressPurpose } from '../../tron/types/address-purpose.enum';
import { EmailVerification } from '../../users/entities/email-verification.entity';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { UserBackupCode } from '../../users/entities/user-backup-code.entity';
import { User } from '../../users/entities/user.entity';
import { BankDetailTagLink } from '../../bank-details/entities/bank-detail-tag-link.entity';
import { BankDetailTag } from '../../bank-details/entities/bank-detail-tag.entity';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { DeviceCredential } from '../../devices/entities/device-credential.entity';
import { DevicePairing } from '../../devices/entities/device-pairing.entity';
import { Device } from '../../devices/entities/device.entity';
import { MobileOperator } from '../../mobile-operators/entities/mobile-operator.entity';
import { MerchantCallback } from '../../merchant-callbacks/entities/merchant-callback.entity';
import { FileStorage } from '../../file-storage/types/file-storage';
import { PayoutDecline } from '../../transactions/entities/payout-decline.entity';
import { SelectionAttempt } from '../../transactions/entities/selection-attempt.entity';
import { TransactionDispute } from '../../transactions/entities/transaction-dispute.entity';
import { TransactionFile } from '../../transactions/entities/transaction-file.entity';
import { AccountTransactionsModule } from '../account-transactions.module';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { DepositAddress } from '../entities/deposit-address.entity';
import { DepositTransfer } from '../entities/deposit-transfer.entity';
import { WithdrawalAttempt } from '../entities/withdrawal-attempt.entity';
import { WithdrawalQuote } from '../entities/withdrawal-quote.entity';
import { DepositsService } from '../services/deposits.service';
import { TransfersService } from '../services/transfers.service';
import { WithdrawalsService } from '../services/withdrawals.service';

describe('the account transactions module graph', () => {
  const repository = {};
  const dataSource = { transaction: jest.fn(), manager: {} };
  const entities = [
    AccountTransaction,
    Counterparty,
    CounterpartyDailyVolume,
    CounterpartyDailyRequest,
    MerchantApiRequest,
    CounterpartyRequisiteEvent,
    DepositAddress,
    DepositTransfer,
    WithdrawalAttempt,
    WithdrawalQuote,
    TronAddress,
    TronScanCursor,
    TronOutgoingTransfer,
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
    NotificationSetting,
    AuditLog,
    AuditInstallation,
    ActivityRead,
    Bank,
    Country,
    Currency,
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
    MerchantCallback,
    BankDetails,
    BankDetailTag,
    BankDetailTagLink,
    Device,
    DevicePairing,
    DeviceCredential,
    MobileOperator,
  ];

  @Global()
  @Module({
    providers: [{ provide: getDataSourceToken(), useValue: dataSource }],
    exports: [getDataSourceToken()],
  })
  class FakeDataSourceModule {}

  const compile = () => {
    let builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FakeDataSourceModule,
        AccountTransactionsModule,
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
        get: jest.fn((key: string) => (key === 'VICTORIA_LOGS_URL' ? '' : 0)),
        getOrThrow: jest.fn(() => 'x'),
      })
      .compile();
  };

  it('resolves every provider of the module and of the Tron engine', async () => {
    await expect(compile()).resolves.toBeDefined();
  });

  it('exposes the deposit, withdrawal and transfer services', async () => {
    const module = await compile();

    expect(module.get(DepositsService)).toBeInstanceOf(DepositsService);
    expect(module.get(WithdrawalsService)).toBeInstanceOf(WithdrawalsService);
    expect(module.get(TransfersService)).toBeInstanceOf(TransfersService);
  });

  it('wires the deposit handler into the scanner and the withdrawal handler into the tracker', async () => {
    const module = await compile();
    const scanner = module.get(UsdtTransferScanner, { strict: false });
    const tracker = module.get(TronConfirmationTracker, { strict: false });
    module.get(DepositsService).onModuleInit();

    expect(
      (scanner as unknown as { handlers: Map<string, unknown> }).handlers.has(
        AddressPurpose.Deposit,
      ),
    ).toBe(true);
    expect(
      (tracker as unknown as { handlers: Map<string, unknown> }).handlers.has(
        'withdrawal',
      ),
    ).toBe(true);
  });
});
