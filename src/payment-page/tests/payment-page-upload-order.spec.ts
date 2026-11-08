import { INestApplication, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PaymentPageService } from '../../transactions/services/payment-page.service';
import { PayPageRateLimitGuard } from '../guards/pay-page-rate-limit.guard';
import { PayReceiptGuard } from '../guards/pay-receipt.guard';
import { PaymentPageController } from '../payment-page.controller';

const LIVE = 'a'.repeat(43);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

describe('the receipt route reads no body before its guard passes', () => {
  let app: INestApplication;
  const handleFile = jest.fn(
    (
      _request: unknown,
      file: { stream: NodeJS.ReadableStream },
      done: (error: null, info: object) => void,
    ) => {
      const chunks: Buffer[] = [];

      file.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      file.stream.on('end', () =>
        done(null, { buffer: Buffer.concat(chunks) }),
      );
    },
  );
  const pages = {
    assertAcceptsReceipt: jest.fn(async (token: string) => {
      if (token !== LIVE) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'PAYMENT_PAGE_NOT_FOUND',
          message: 'Payment page not found',
        });
      }
    }),
    uploadReceipt: jest.fn(async () => ({
      name: 'r.pdf',
      size: PDF.length,
      mime: 'application/pdf',
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MulterModule.register({
          storage: { _handleFile: handleFile, _removeFile: jest.fn() },
        }),
      ],
      controllers: [PaymentPageController],
      providers: [
        PayPageRateLimitGuard,
        PayReceiptGuard,
        { provide: PaymentPageService, useValue: pages },
        { provide: ConfigService, useValue: { getOrThrow: () => 1000 } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => handleFile.mockClear());

  it('answers an unknown token 404 and multer never touches the file', async () => {
    const response = await request(app.getHttpServer())
      .post(`/pay/${'b'.repeat(43)}/receipt`)
      .attach('file', PDF, 'r.pdf')
      .expect(404);

    expect(response.body.code).toBe('PAYMENT_PAGE_NOT_FOUND');
    expect(handleFile).not.toHaveBeenCalled();
    expect(pages.uploadReceipt).not.toHaveBeenCalled();
  });

  it('reads the file once the token is live', async () => {
    await request(app.getHttpServer())
      .post(`/pay/${LIVE}/receipt`)
      .attach('file', PDF, 'r.pdf')
      .expect(201);

    expect(handleFile).toHaveBeenCalledTimes(1);
    expect(pages.uploadReceipt).toHaveBeenCalledWith(LIVE, {
      buffer: PDF,
      name: 'r.pdf',
    });
  });
});
