import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankDetailsModule } from '../bank-details/bank-details.module';
import { DevicesModule } from '../devices/devices.module';
import { MessageTemplatesModule } from '../message-templates/message-templates.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { DeviceMessagesController } from './device-messages.controller';
import { DeviceMessage } from './entities/device-message.entity';
import { DeviceMessagesService } from './services/device-messages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeviceMessage]),
    DevicesModule,
    BankDetailsModule,
    MessageTemplatesModule,
    TransactionsModule,
    UsersModule,
  ],
  controllers: [DeviceMessagesController],
  providers: [DeviceMessagesService],
  exports: [DeviceMessagesService],
})
export class DeviceMessagesModule {}
