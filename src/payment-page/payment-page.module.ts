import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { dealFileUploadOptions } from '../file-storage/utils/deal-file-upload-options';
import { TransactionsModule } from '../transactions/transactions.module';
import { PayPageRateLimitGuard } from './guards/pay-page-rate-limit.guard';
import { PaymentPageController } from './payment-page.controller';

@Module({
  imports: [
    TransactionsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: dealFileUploadOptions,
    }),
  ],
  controllers: [PaymentPageController],
  providers: [PayPageRateLimitGuard],
})
export class PaymentPageModule {}
