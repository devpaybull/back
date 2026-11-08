import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { dealFileUploadOptions } from '../file-storage/utils/deal-file-upload-options';
import { AccountTransactionsModule } from '../account-transactions/account-transactions.module';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { DeviceMessagesModule } from '../device-messages/device-messages.module';
import { DevicesModule } from '../devices/devices.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { TraderBalancesController } from './controllers/trader-balances.controller';
import { TraderSummaryController } from './controllers/trader-summary.controller';
import { TraderAppealsController } from './controllers/trader-appeals.controller';
import { TraderDealsController } from './controllers/trader-deals.controller';
import { TraderFilesController } from './controllers/trader-files.controller';
import { TraderMessagesController } from './controllers/trader-messages.controller';
import { TraderPayoutsController } from './controllers/trader-payouts.controller';

@Module({
  imports: [
    AccountTransactionsModule,
    BankDetailsModule,
    BanksModule,
    CounterpartiesModule,
    DeviceMessagesModule,
    DevicesModule,
    MerchantsModule,
    TraderSettingsModule,
    TransactionsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: dealFileUploadOptions,
    }),
  ],
  controllers: [
    TraderSummaryController,
    TraderBalancesController,
    TraderDealsController,
    TraderPayoutsController,
    TraderFilesController,
    TraderAppealsController,
    TraderMessagesController,
  ],
})
export class TraderCabinetModule {}
