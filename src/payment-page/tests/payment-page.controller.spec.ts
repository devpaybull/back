import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PUBLIC_METADATA_KEY } from '../../common/decorators/public.decorator';
import { PayPageRateLimitGuard } from '../guards/pay-page-rate-limit.guard';
import { PaymentPageController } from '../payment-page.controller';

const TOKEN = 'a'.repeat(43);

describe('PaymentPageController', () => {
  const build = () => {
    const pages = {
      view: jest.fn(async () => ({ status: 'active' })),
      markPaid: jest.fn(async () => ({ status: 'checking' })),
      uploadReceipt: jest.fn(async () => ({
        name: 'чек.pdf',
        size: 4,
        mime: 'application/pdf',
      })),
    };

    return { pages, controller: new PaymentPageController(pages as never) };
  };

  it('needs no JWT and every route passes the rate limit', () => {
    expect(
      Reflect.getMetadata(PUBLIC_METADATA_KEY, PaymentPageController),
    ).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, PaymentPageController)).toEqual(
      [PayPageRateLimitGuard],
    );
  });

  it('hands the token to the service', async () => {
    const { pages, controller } = build();

    await controller.view(TOKEN);
    await controller.paid(TOKEN);

    expect(pages.view).toHaveBeenCalledWith(TOKEN);
    expect(pages.markPaid).toHaveBeenCalledWith(TOKEN);
  });

  it('reads the file name as UTF-8 and refuses a request without a file', async () => {
    const { pages, controller } = build();

    await controller.receipt(TOKEN, {
      buffer: Buffer.from('%PDF'),
      originalname: Buffer.from('чек.pdf', 'utf8').toString('latin1'),
    } as Express.Multer.File);

    expect(pages.uploadReceipt).toHaveBeenCalledWith(TOKEN, {
      buffer: Buffer.from('%PDF'),
      name: 'чек.pdf',
    });
    expect(() => controller.receipt(TOKEN)).toThrow(BadRequestException);
  });
});
