import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { BalanceOperation } from './entities/balance-operation.entity';
import { MethodRate } from './entities/method-rate.entity';
import { Transaction } from './entities/transaction.entity';
import { TransactionStatusEvent } from './entities/transaction-status-event.entity';
import { Wallet } from './entities/wallet.entity';
import { RapiraRateProvider } from './services/rapira-rate.provider';
import { RateService } from './services/rate.service';
import { TransactionService } from './services/transaction.service';
import { WalletService } from './services/wallet.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      TransactionStatusEvent,
      Wallet,
      BalanceOperation,
      MethodRate,
    ]),
    AuditModule,
    TraderSettingsModule,
  ],
  providers: [
    RapiraRateProvider,
    RateService,
    WalletService,
    TransactionService,
  ],
  exports: [RateService, WalletService, TransactionService],
})
export class TransactionsModule {}
