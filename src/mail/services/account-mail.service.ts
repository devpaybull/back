import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailConfirmationCodeMailInput,
  PasswordRecoveryCodeMailInput,
} from '../types/mail-message';
import { MailTransportService } from './mail-transport.service';

const RESET_PAGE_PATH = '/reset-password';

@Injectable()
export class AccountMailService {
  constructor(
    private readonly transport: MailTransportService,
    private readonly config: ConfigService,
  ) {}

  sendEmailConfirmationCode(
    input: EmailConfirmationCodeMailInput,
  ): Promise<boolean> {
    return this.transport.send({
      to: input.to,
      subject: 'Confirm your Paybull email address',
      text: [
        `Your confirmation code: ${input.code}`,
        `It is valid until ${input.expiresAt.toISOString()}.`,
      ].join('\n'),
    });
  }

  sendPasswordRecoveryCode(
    input: PasswordRecoveryCodeMailInput,
  ): Promise<boolean> {
    const appUrl = this.config.get<string>('APP_URL');
    const query = new URLSearchParams({
      login: input.login,
      code: input.code,
    });
    const linkLine = appUrl
      ? `Or follow this link: ${appUrl.replace(/\/+$/, '')}${RESET_PAGE_PATH}?${query.toString()}`
      : 'There is no reset page for this installation — type the code into the app together with your login.';

    return this.transport.send({
      to: input.to,
      subject: 'Reset your Paybull password',
      text: [
        `Your password reset code: ${input.code}`,
        linkLine,
        `It is valid until ${input.expiresAt.toISOString()}.`,
        'If you did not ask to reset your password, ignore this message.',
      ].join('\n'),
    });
  }
}
