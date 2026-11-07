import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
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
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          files: 1,
          fields: 0,
          parts: 1,
          fileSize: config.getOrThrow<number>('DISPUTE_FILE_MAX_BYTES'),
        },
      }),
    }),
  ],
  controllers: [
    TraderDealsController,
    TraderPayoutsController,
    TraderFilesController,
  ],
})
export class TraderCabinetModule {}
