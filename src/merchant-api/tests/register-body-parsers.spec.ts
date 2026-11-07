import {
  Body,
  Controller,
  HttpCode,
  INestApplication,
  Post,
  UseFilters,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt, IsOptional } from 'class-validator';
import request from 'supertest';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { FieldErrorsValidationPipe } from '../../common/pipes/field-errors-validation.pipe';
import { MerchantApiExceptionFilter } from '../filters/merchant-api-exception.filter';
import { registerBodyParsers } from '../utils/register-body-parsers';

class AmountDto {
  @IsFiatAmount({ positive: true })
  amount: string;

  @IsOptional()
  @IsInt()
  timeoutInMin?: number;
}

@Controller('v1/probe')
@UseFilters(MerchantApiExceptionFilter)
class MerchantProbeController {
  @Post()
  @HttpCode(200)
  probe(@Body() dto: AmountDto): AmountDto {
    return dto;
  }
}

@Controller('probe')
class ProbeController {
  @Post()
  @HttpCode(200)
  probe(@Body() dto: AmountDto): AmountDto {
    return dto;
  }
}

describe('registerBodyParsers', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MerchantProbeController, ProbeController],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    registerBodyParsers(app);
    app.useGlobalPipes(
      new FieldErrorsValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(() => app.close());

  const post = (path: string, raw: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Content-Type', 'application/json')
      .send(raw);

  describe('on /v1', () => {
    it.each([
      ['2000', '2000'],
      ['"2000.5"', '2000.5'],
      ['2000.50', '2000.50'],
      ['"2000"', '2000'],
    ])('accepts the amount %s as the decimal text %s', async (raw, text) => {
      const response = await post('/v1/probe', `{"amount":${raw}}`).expect(200);

      expect(response.body.amount).toBe(text);
    });

    it.each(['2000.505', '1e3', '-1', '0', '"2000.505"'])(
      'refuses the amount %s with VALIDATION_FAILED',
      async (raw) => {
        const response = await post('/v1/probe', `{"amount":${raw}}`).expect(
          400,
        );

        expect(response.body).toEqual({
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: [{ field: 'amount', code: 'isFiatAmount' }],
        });
      },
    );

    it('keeps a number that is not money a number', async () => {
      const response = await post(
        '/v1/probe',
        '{"amount":"10","timeoutInMin":30}',
      ).expect(200);

      expect(response.body.timeoutInMin).toBe(30);
    });

    it('keeps the source of a number past what a float holds', async () => {
      const response = await post(
        '/v1/probe',
        '{"amount":999999999999.99}',
      ).expect(200);

      expect(response.body.amount).toBe('999999999999.99');
    });
  });

  describe('everywhere else', () => {
    it('still refuses a JSON number as an amount', async () => {
      const response = await post('/probe', '{"amount":2000}').expect(400);

      expect(response.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: [expect.stringContaining('amount must be a decimal string')],
      });
    });

    it('accepts the amount as a string', async () => {
      await post('/probe', '{"amount":"2000.50"}').expect(200);
    });

    it('still parses url-encoded bodies', async () => {
      await request(app.getHttpServer())
        .post('/probe')
        .type('form')
        .send('amount=5')
        .expect(200);
    });
  });
});
