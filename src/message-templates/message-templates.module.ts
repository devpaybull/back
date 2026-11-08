import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BanksModule } from '../banks/banks.module';
import { BankMessageTemplate } from './entities/bank-message-template.entity';
import { MessageTemplatesService } from './message-templates.service';

@Module({
  imports: [TypeOrmModule.forFeature([BankMessageTemplate]), BanksModule],
  providers: [MessageTemplatesService],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
