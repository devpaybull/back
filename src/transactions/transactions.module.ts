import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BanksModule } from '../banks/banks.module';
import { TraderSettingsModule } from '../trader-settings/trader-settings.module';
import { UsersModule } from '../users/users.module';
import { BalanceOperation } from './entities/balance-operation.entity';
import { LeadRate } from './entities/lead-rate.entity';
import { MethodRate } from './entities/method-rate.entity';
import { Transaction } from './entities/transaction.entity';
import { TransactionLeadShare } from './entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from './entities/transaction-status-event.entity';
import { Wallet } from './entities/wallet.entity';
import { BankDetailsTurnoverService } from './services/bank-details-turnover.service';
import { DealExpiryService } from './services/deal-expiry.service';
import { NightStopService } from './services/night-stop.service';
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
      LeadRate,
      TransactionLeadShare,
    ]),
    AuditModule,
    BanksModule,
    TraderSettingsModule,
    UsersModule,
  ],
  providers: [
    RapiraRateProvider,
    RateService,
    WalletService,
    TransactionService,
    NightStopService,
    BankDetailsTurnoverService,
    DealExpiryService,
  ],
  exports: [
    RateService,
    WalletService,
    TransactionService,
    NightStopService,
    BankDetailsTurnoverService,
  ],
})
export class TransactionsModule {}
