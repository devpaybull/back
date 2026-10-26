import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { TronModule } from '../tron/tron.module';
import { UsersModule } from '../users/users.module';
import { DepositsController } from './controllers/deposits.controller';
import { FinanceOperationsController } from './controllers/finance-operations.controller';
import { WithdrawalsController } from './controllers/withdrawals.controller';
import { AccountTransaction } from './entities/account-transaction.entity';
import { DepositAddress } from './entities/deposit-address.entity';
import { DepositTransfer } from './entities/deposit-transfer.entity';
import { WithdrawalAttempt } from './entities/withdrawal-attempt.entity';
import { WithdrawalQuote } from './entities/withdrawal-quote.entity';
import { AccountTransactionsService } from './services/account-transactions.service';
import { DepositExpiryService } from './services/deposit-expiry.service';
import { DepositsService } from './services/deposits.service';
import { PayoutQueueService } from './services/payout-queue.service';
import { TransfersService } from './services/transfers.service';
import { WithdrawalsService } from './services/withdrawals.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountTransaction,
      DepositAddress,
      DepositTransfer,
      WithdrawalAttempt,
      WithdrawalQuote,
    ]),
    AuditModule,
    TransactionsModule,
    TronModule,
    UsersModule,
  ],
  controllers: [
    DepositsController,
    WithdrawalsController,
    FinanceOperationsController,
  ],
  providers: [
    TransfersService,
    DepositsService,
    DepositExpiryService,
    WithdrawalsService,
    PayoutQueueService,
    AccountTransactionsService,
  ],
  exports: [
    TransfersService,
    DepositsService,
    WithdrawalsService,
    AccountTransactionsService,
  ],
})
export class AccountTransactionsModule {}
