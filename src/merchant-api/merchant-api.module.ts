import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { BanksModule } from '../banks/banks.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { MerchantRequestsModule } from '../merchant-requests/merchant-requests.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { MobileOperatorsModule } from '../mobile-operators/mobile-operators.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { MerchantApiAccountController } from './controllers/merchant-api-account.controller';
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
  ],
  controllers: [MerchantApiAccountController, MerchantApiPaymentsController],
  providers: [MerchantApiKeyGuard, MerchantApiService],
})
export class MerchantApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(MerchantRequestLogMiddleware)
      .forRoutes({ path: 'v1/{*path}', method: RequestMethod.ALL });
  }
}
