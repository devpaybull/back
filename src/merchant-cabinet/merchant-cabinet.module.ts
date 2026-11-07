import { Module } from '@nestjs/common';
import { AccountTransactionsModule } from '../account-transactions/account-transactions.module';
import { AuditModule } from '../audit/audit.module';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { MerchantCallbacksModule } from '../merchant-callbacks/merchant-callbacks.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { MerchantAccountController } from './controllers/merchant-account.controller';
import { MerchantBalanceController } from './controllers/merchant-balance.controller';
import { MerchantCallbacksController } from './controllers/merchant-callbacks.controller';
import { MerchantDashboardController } from './controllers/merchant-dashboard.controller';
import { MerchantDealsController } from './controllers/merchant-deals.controller';
import { MerchantRatesController } from './controllers/merchant-rates.controller';
import { MerchantSettingsController } from './controllers/merchant-settings.controller';
import { MerchantWithdrawalsController } from './controllers/merchant-withdrawals.controller';
import { MerchantScopeGuard } from './guards/merchant-scope.guard';

@Module({
  imports: [
    AccountTransactionsModule,
    AuditModule,
    BankDetailsModule,
    BanksModule,
    CounterpartiesModule,
    MerchantCallbacksModule,
    MerchantsModule,
    TransactionsModule,
    UsersModule,
  ],
  controllers: [
    MerchantAccountController,
    MerchantDashboardController,
    MerchantDealsController,
    MerchantBalanceController,
    MerchantWithdrawalsController,
    MerchantRatesController,
    MerchantSettingsController,
    MerchantCallbacksController,
  ],
  providers: [MerchantScopeGuard],
})
export class MerchantCabinetModule {}
