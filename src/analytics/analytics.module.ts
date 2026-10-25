import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [TransactionsModule],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
