import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { MailMessage } from '../types/mail-message';

@Injectable()
export class MailTransportService {
  private readonly logger = new Logger(MailTransportService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('MAIL_HOST');
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASSWORD');

    this.transporter = host
      ? createTransport({
          host,
          port: this.config.get<number>('MAIL_PORT'),
          secure: this.config.get<boolean>('MAIL_SECURE'),
          auth: user ? { user, pass } : undefined,
        })
      : null;

    if (!this.transporter) {
      this.logger.warn('MAIL_HOST is empty — outgoing mail is disabled');
    }
  }

  get isEnabled(): boolean {
    return Boolean(this.transporter);
  }

  async send(message: MailMessage): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(
        `Mail is disabled — "${message.subject}" for ${message.to} was not sent`,
      );

      return false;
    }

    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to: message.to,
      subject: message.subject,
      text: message.text,
    });

    this.logger.log(`Sent "${message.subject}" to ${message.to}`);

    return true;
  }
}
