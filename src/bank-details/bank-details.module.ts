import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BanksModule } from '../banks/banks.module';
import { DevicesModule } from '../devices/devices.module';
import { BankDetailsController } from './bank-details.controller';
import { BankDetailsService } from './bank-details.service';
import { BankDetails } from './entities/bank-details.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BankDetails]),
    AuditModule,
    BanksModule,
    forwardRef(() => DevicesModule),
  ],
  controllers: [BankDetailsController],
  providers: [BankDetailsService],
  exports: [BankDetailsService],
})
export class BankDetailsModule {}
