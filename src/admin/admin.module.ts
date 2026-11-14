import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { dealFileUploadOptions } from '../file-storage/utils/deal-file-upload-options';
import { MerchantCallbacksModule } from '../merchant-callbacks/merchant-callbacks.module';
import { AdminMerchantCallbacksController } from './controllers/admin-merchant-callbacks.controller';
import { AdminDisputesController } from './controllers/admin-disputes.controller';
import { Module } from '@nestjs/common';
import { AdminDepositsController } from './controllers/admin-deposits.controller';
import { AdminWithdrawalsController } from './controllers/admin-withdrawals.controller';
import { AccountTransactionsModule } from '../account-transactions/account-transactions.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { MessageTemplatesModule } from '../message-templates/message-templates.module';
import { MobileOperatorsModule } from '../mobile-operators/mobile-operators.module';
import { CountriesModule } from '../countries/countries.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { DebtsModule } from '../debts/debts.module';
import { DeviceMessagesModule } from '../device-messages/device-messages.module';
import { DevicesModule } from '../devices/devices.module';
import { InvitesModule } from '../invites/invites.module';
import { MerchantRequestsModule } from '../merchant-requests/merchant-requests.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UserNotesModule } from '../user-notes/user-notes.module';
import { UsersModule } from '../users/users.module';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminMerchantAttachmentsController } from './controllers/admin-merchant-attachments.controller';
import { AdminMerchantBalanceController } from './controllers/admin-merchant-balance.controller';
import { AdminMerchantRequestsController } from './controllers/admin-merchant-requests.controller';
import { AdminMerchantIntegrationsController } from './controllers/admin-merchant-integrations.controller';
import { AdminMerchantGroupsController } from './controllers/admin-merchant-groups.controller';
import { AdminAuditController } from './controllers/admin-audit.controller';
import { AdminBalancesController } from './controllers/admin-balances.controller';
import { AdminBankDetailsController } from './controllers/admin-bank-details.controller';
import { AdminBanksController } from './controllers/admin-banks.controller';
import { AdminCounterpartiesController } from './controllers/admin-counterparties.controller';
import { AdminCounterpartyRequisitesController } from './controllers/admin-counterparty-requisites.controller';
import { AdminCountriesController } from './controllers/admin-countries.controller';
import { AdminCurrenciesController } from './controllers/admin-currencies.controller';
import { AdminDebtsController } from './controllers/admin-debts.controller';
import { AdminDeviceMessagesController } from './controllers/admin-device-messages.controller';
import { AdminDevicesController } from './controllers/admin-devices.controller';
import { AdminIdentityController } from './controllers/admin-identity.controller';
import { AdminInvitesController } from './controllers/admin-invites.controller';
import { AdminLeadsController } from './controllers/admin-leads.controller';
import { AdminMerchantsController } from './controllers/admin-merchants.controller';
import { AdminMessageTemplatesController } from './controllers/admin-message-templates.controller';
import { AdminMobileOperatorsController } from './controllers/admin-mobile-operators.controller';
import { AdminRatesController } from './controllers/admin-rates.controller';
import { AdminRolesController } from './controllers/admin-roles.controller';
import { AdminTraderSettingsController } from './controllers/admin-trader-settings.controller';
import { AdminTransactionsController } from './controllers/admin-transactions.controller';
import { AdminUserNotesController } from './controllers/admin-user-notes.controller';
import { AdminUsersController } from './controllers/admin-users.controller';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: dealFileUploadOptions,
    }),
    AuthModule,
    InvitesModule,
    UsersModule,
    BanksModule,
    MessageTemplatesModule,
    MobileOperatorsModule,
    DevicesModule,
    DeviceMessagesModule,
    BankDetailsModule,
    CountriesModule,
    CurrenciesModule,
    TransactionsModule,
    MerchantCallbacksModule,
    AccountTransactionsModule,
    AuditModule,
    TraderSettingsModule,
    CounterpartiesModule,
    AnalyticsModule,
    MerchantsModule,
    MerchantRequestsModule,
    UserNotesModule,
    DebtsModule,
  ],
  controllers: [
    AdminMerchantCallbacksController,
    AdminDisputesController,
    AdminDepositsController,
    AdminWithdrawalsController,
    AdminInvitesController,
    AdminUsersController,
    AdminLeadsController,
    AdminRolesController,
    AdminTransactionsController,
    AdminAuditController,
    AdminBalancesController,
    AdminDebtsController,
    AdminTraderSettingsController,
    AdminRatesController,
    AdminCounterpartiesController,
    AdminCounterpartyRequisitesController,
    AdminAnalyticsController,
    AdminMerchantsController,
    AdminMerchantIntegrationsController,
    AdminMerchantBalanceController,
    AdminMerchantRequestsController,
    AdminMerchantGroupsController,
    AdminMerchantAttachmentsController,
    AdminBanksController,
    AdminMessageTemplatesController,
    AdminMobileOperatorsController,
    AdminDevicesController,
    AdminDeviceMessagesController,
    AdminBankDetailsController,
    AdminCountriesController,
    AdminCurrenciesController,
    AdminUserNotesController,
    AdminIdentityController,
  ],
})
export class AdminModule {}
