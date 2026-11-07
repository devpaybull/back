import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { DeviceApiController } from './controllers/device-api.controller';
import { DevicesController } from './controllers/devices.controller';
import { DevicesService } from './devices.service';
import { DeviceCredential } from './entities/device-credential.entity';
import { DevicePairing } from './entities/device-pairing.entity';
import { Device } from './entities/device.entity';
import { DeviceTokenGuard } from './guards/device-token.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, DevicePairing, DeviceCredential]),
    AuditModule,
    forwardRef(() => BankDetailsModule),
  ],
  controllers: [DevicesController, DeviceApiController],
  providers: [DevicesService, DeviceTokenGuard],
  exports: [DevicesService],
})
export class DevicesModule {}
