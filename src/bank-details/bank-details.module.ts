import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BanksModule } from '../banks/banks.module';
import { CounterpartiesModule } from '../counterparties/counterparties.module';
import { DevicesModule } from '../devices/devices.module';
import { MobileOperatorsModule } from '../mobile-operators/mobile-operators.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { BankDetailsController } from './bank-details.controller';
import { BankDetailsService } from './bank-details.service';
import { BankDetailTagLink } from './entities/bank-detail-tag-link.entity';
import { BankDetailTag } from './entities/bank-detail-tag.entity';
import { BankDetails } from './entities/bank-details.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankDetails, BankDetailTag, BankDetailTagLink]),
    AuditModule,
    BanksModule,
    CounterpartiesModule,
    MobileOperatorsModule,
    forwardRef(() => TransactionsModule),
    forwardRef(() => DevicesModule),
  ],
  controllers: [BankDetailsController],
  providers: [BankDetailsService],
  exports: [BankDetailsService],
})
export class BankDetailsModule {}
