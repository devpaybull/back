import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { CountriesModule } from '../countries/countries.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { DevicesModule } from '../devices/devices.module';
import { InvitesModule } from '../invites/invites.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminAuditController } from './controllers/admin-audit.controller';
import { AdminBalancesController } from './controllers/admin-balances.controller';
import { AdminBankDetailsController } from './controllers/admin-bank-details.controller';
import { AdminBanksController } from './controllers/admin-banks.controller';
import { AdminCounterpartiesController } from './controllers/admin-counterparties.controller';
import { AdminCountriesController } from './controllers/admin-countries.controller';
import { AdminCurrenciesController } from './controllers/admin-currencies.controller';
import { AdminDevicesController } from './controllers/admin-devices.controller';
import { AdminInvitesController } from './controllers/admin-invites.controller';
import { AdminMerchantsController } from './controllers/admin-merchants.controller';
import { AdminRatesController } from './controllers/admin-rates.controller';
import { AdminTraderSettingsController } from './controllers/admin-trader-settings.controller';
import { AdminTransactionsController } from './controllers/admin-transactions.controller';
import { AdminUsersController } from './controllers/admin-users.controller';

@Module({
  imports: [
    AuthModule,
    InvitesModule,
    UsersModule,
    BanksModule,
    DevicesModule,
    BankDetailsModule,
    CountriesModule,
    CurrenciesModule,
    TransactionsModule,
    AuditModule,
    TraderSettingsModule,
    CounterpartiesModule,
    AnalyticsModule,
    MerchantsModule,
  ],
  controllers: [
    AdminInvitesController,
    AdminUsersController,
    AdminTransactionsController,
    AdminAuditController,
    AdminBalancesController,
    AdminTraderSettingsController,
    AdminRatesController,
    AdminCounterpartiesController,
    AdminAnalyticsController,
    AdminMerchantsController,
    AdminBanksController,
    AdminDevicesController,
    AdminBankDetailsController,
    AdminCountriesController,
    AdminCurrenciesController,
  ],
})
export class AdminModule {}
