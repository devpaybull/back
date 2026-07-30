import { Module } from '@nestjs/common';
import { AccountMailService } from './services/account-mail.service';
import { MailTransportService } from './services/mail-transport.service';

@Module({
  providers: [MailTransportService, AccountMailService],
  exports: [AccountMailService],
})
export class MailModule {}
