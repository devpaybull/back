import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { dealFileUploadOptions } from '../file-storage/utils/deal-file-upload-options';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { MerchantRequestsModule } from '../merchant-requests/merchant-requests.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { MobileOperatorsModule } from '../mobile-operators/mobile-operators.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { MerchantApiAccountController } from './controllers/merchant-api-account.controller';
import { MerchantApiFilesController } from './controllers/merchant-api-files.controller';
import { MerchantApiPaymentsController } from './controllers/merchant-api-payments.controller';
import { MerchantApiKeyGuard } from './guards/merchant-api-key.guard';
import { MerchantApiService } from './merchant-api.service';
import { MerchantRequestLogMiddleware } from './middleware/merchant-request-log.middleware';

@Module({
  imports: [
    MerchantsModule,
    MerchantRequestsModule,
    TransactionsModule,
    BanksModule,
    BankDetailsModule,
    CounterpartiesModule,
    MobileOperatorsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: dealFileUploadOptions,
    }),
  ],
  controllers: [
    MerchantApiAccountController,
    MerchantApiPaymentsController,
    MerchantApiFilesController,
  ],
  providers: [MerchantApiKeyGuard, MerchantApiService],
})
export class MerchantApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(MerchantRequestLogMiddleware)
      .forRoutes({ path: 'v1/{*path}', method: RequestMethod.ALL });
  }
}
