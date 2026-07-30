import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createTransport } from 'nodemailer';
import { MailTransportService } from '../services/mail-transport.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const sendMail = jest.fn();
const createTransportMock = createTransport as jest.Mock;

const build = async (
  env: Record<string, unknown>,
): Promise<MailTransportService> => {
  const module = await Test.createTestingModule({
    providers: [
      MailTransportService,
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
    ],
  }).compile();

  return module.get(MailTransportService);
};

describe('MailTransportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTransportMock.mockReturnValue({ sendMail });
  });

  describe('without MAIL_HOST', () => {
    it('builds no transport at all', async () => {
      const service = await build({ MAIL_HOST: '' });

      expect(createTransportMock).not.toHaveBeenCalled();
      expect(service.isEnabled).toBe(false);
    });

    it('swallows the message instead of failing the caller', async () => {
      const service = await build({ MAIL_HOST: '' });

      await expect(
        service.send({ to: 'user@example.com', subject: 'Code', text: 'X7QP' }),
      ).resolves.toBe(false);
      expect(sendMail).not.toHaveBeenCalled();
    });
  });

  describe('with MAIL_HOST', () => {
    const env = {
      MAIL_HOST: 'smtp.example.com',
      MAIL_PORT: 587,
      MAIL_SECURE: false,
      MAIL_USER: 'mailer',
      MAIL_PASSWORD: 'secret',
      MAIL_FROM: 'no-reply@example.com',
    };

    it('authenticates when a user is configured', async () => {
      const service = await build(env);

      expect(service.isEnabled).toBe(true);
      expect(createTransportMock).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'mailer', pass: 'secret' },
      });
    });

    it('connects anonymously when no user is configured', async () => {
      await build({ ...env, MAIL_USER: '' });

      expect(createTransportMock).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });

    it('sends from the configured address', async () => {
      const service = await build(env);

      await expect(
        service.send({ to: 'user@example.com', subject: 'Code', text: 'X7QP' }),
      ).resolves.toBe(true);
      expect(sendMail).toHaveBeenCalledWith({
        from: 'no-reply@example.com',
        to: 'user@example.com',
        subject: 'Code',
        text: 'X7QP',
      });
    });
  });
});
