import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { Device } from './entities/device.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device]),
    forwardRef(() => BankDetailsModule),
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
