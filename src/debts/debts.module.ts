import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { DebtEvent } from './entities/debt-event.entity';
import { Debt } from './entities/debt.entity';
import { DebtAutoWriteOffService } from './services/debt-auto-write-off.service';
import { DebtsService } from './services/debts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Debt, DebtEvent]),
    AuditModule,
    TransactionsModule,
    UsersModule,
  ],
  providers: [DebtsService, DebtAutoWriteOffService],
  exports: [DebtsService],
})
export class DebtsModule {}
