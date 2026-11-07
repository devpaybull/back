import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { dealFileUploadOptions } from '../file-storage/utils/deal-file-upload-options';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { TraderAppealsController } from './controllers/trader-appeals.controller';
import { TraderDealsController } from './controllers/trader-deals.controller';
import { TraderFilesController } from './controllers/trader-files.controller';
import { TraderPayoutsController } from './controllers/trader-payouts.controller';

@Module({
  imports: [
    BankDetailsModule,
    BanksModule,
    CounterpartiesModule,
    MerchantsModule,
    TraderSettingsModule,
    TransactionsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: dealFileUploadOptions,
    }),
  ],
  controllers: [
    TraderDealsController,
    TraderPayoutsController,
    TraderFilesController,
    TraderAppealsController,
  ],
})
export class TraderCabinetModule {}
