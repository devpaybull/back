import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createTransport } from 'nodemailer';
import { AccountMailService } from '../services/account-mail.service';
import { MailTransportService } from '../services/mail-transport.service';
import { MailMessage } from '../types/mail-message';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const sendMail = jest.fn();
const createTransportMock = createTransport as jest.Mock;

const ENABLED = {
  MAIL_HOST: 'smtp.example.com',
  MAIL_PORT: 587,
  MAIL_SECURE: false,
  MAIL_USER: 'mailer',
  MAIL_PASSWORD: 'secret',
  MAIL_FROM: 'no-reply@example.com',
  APP_URL: '',
};

const EXPIRES_AT = new Date('2026-07-29T12:34:56.000Z');

const build = async (
  env: Record<string, unknown>,
): Promise<AccountMailService> => {
  const module = await Test.createTestingModule({
    providers: [
      AccountMailService,
      MailTransportService,
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
    ],
  }).compile();

  return module.get(AccountMailService);
};

const sentMessage = (): MailMessage & { from: string } =>
  sendMail.mock.calls[0][0];

describe('AccountMailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTransportMock.mockReturnValue({ sendMail });
  });

  describe('sendEmailConfirmationCode', () => {
    const input = {
      to: 'new-address@example.com',
      code: '481502',
      expiresAt: EXPIRES_AT,
    };

    it('mails the code and its expiry to the address being confirmed', async () => {
      const service = await build(ENABLED);

      await expect(service.sendEmailConfirmationCode(input)).resolves.toBe(
        true,
      );
      expect(sentMessage().to).toBe('new-address@example.com');
      expect(sentMessage().text).toContain('481502');
      expect(sentMessage().text).toContain('2026-07-29T12:34:56.000Z');
    });

    it('carries nothing beyond the code and the expiry', async () => {
      const service = await build(ENABLED);

      await service.sendEmailConfirmationCode(input);

      expect(sentMessage().text.split('\n')).toEqual([
        'Your confirmation code: 481502',
        'It is valid until 2026-07-29T12:34:56.000Z.',
      ]);
    });

    it('reports failure without sending when mail is disabled', async () => {
      const service = await build({ ...ENABLED, MAIL_HOST: '' });

      await expect(service.sendEmailConfirmationCode(input)).resolves.toBe(
        false,
      );
      expect(sendMail).not.toHaveBeenCalled();
    });
  });

  describe('sendPasswordRecoveryCode', () => {
    const input = {
      to: 'lost@example.com',
      login: 'lost+tag@example.com',
      code: '903117',
      expiresAt: EXPIRES_AT,
    };

    it('mails the code and its expiry to the account address', async () => {
      const service = await build(ENABLED);

      await expect(service.sendPasswordRecoveryCode(input)).resolves.toBe(true);
      expect(sentMessage().to).toBe('lost@example.com');
      expect(sentMessage().text).toContain('903117');
      expect(sentMessage().text).toContain('2026-07-29T12:34:56.000Z');
    });

    it('carries a reset link with login and code encoded when APP_URL is set', async () => {
      const service = await build({
        ...ENABLED,
        APP_URL: 'https://app.example.com',
      });

      await service.sendPasswordRecoveryCode(input);

      expect(sentMessage().text).toContain(
        'https://app.example.com/reset-password?login=lost%2Btag%40example.com&code=903117',
      );
    });

    it('does not double the slash when APP_URL ends with one', async () => {
      const service = await build({
        ...ENABLED,
        APP_URL: 'https://app.example.com/',
      });

      await service.sendPasswordRecoveryCode(input);

      expect(sentMessage().text).toContain(
        'https://app.example.com/reset-password?',
      );
    });

    it('carries no link at all when APP_URL is empty', async () => {
      const service = await build(ENABLED);

      await service.sendPasswordRecoveryCode(input);

      expect(sentMessage().text).not.toContain('reset-password');
      expect(sentMessage().text).not.toContain('http');
      expect(sentMessage().text).toContain('903117');
    });

    it('reports failure without sending when mail is disabled', async () => {
      const service = await build({ ...ENABLED, MAIL_HOST: '' });

      await expect(service.sendPasswordRecoveryCode(input)).resolves.toBe(
        false,
      );
      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});
