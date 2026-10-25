import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { Device } from './entities/device.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device]),
    AuditModule,
    forwardRef(() => BankDetailsModule),
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
