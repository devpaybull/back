import {
  HttpException,
  HttpStatus,
  NotFoundException,
  PipeTransform,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { PUBLIC_METADATA_KEY } from '../../common/decorators/public.decorator';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toFiat } from '../../common/utils/to-fiat';
import { MerchantApiPaymentsController } from '../controllers/merchant-api-payments.controller';
import { CreatePayInDto } from '../dto/create-pay-in.dto';
import { CreatePayOutDto } from '../dto/create-pay-out.dto';
import { SKIP_IP_CHECK_METADATA_KEY } from '../decorators/skip-ip-check.decorator';
import { ListPaymentsQueryDto } from '../dto/list-payments-query.dto';
import { MerchantApiKeyGuard } from '../guards/merchant-api-key.guard';
import { MerchantApiRequest } from '../types/merchant-api-request';
import { PaymentSortField } from '../types/payment-sort-field.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

const MERCHANT = uuidOf(1);
const REQUEST_ID = uuidOf(9);

const build = (outcome: { created: boolean; sameRequest: boolean }) => {
  const payment = { id: uuidOf(3) };
  const payments = {
    createPayIn: jest.fn(async () => ({ payment, ...outcome })),
  };
  const response = { status: jest.fn(), setHeader: jest.fn() };
  const request = { requestId: REQUEST_ID } as MerchantApiRequest;
  const controller = new MerchantApiPaymentsController(
    payments as never,
    { getOrThrow: () => 'Europe/Moscow' } as never,
  );
  const dto = Object.assign(new CreatePayInDto(), {
    method: 'sbp',
    amount: '2000.50',
    merchantTransactionId: 'order-1',
    payerInfo: { userId: 'client-1' },
  });
  const call = () =>
    controller.payIn(
      { merchantId: MERCHANT, apiKeyId: 1 },
      dto,
      request,
      response as never,
    );

  return { payments, response, request, payment, call };
};

describe('MerchantApiPaymentsController', () => {
  it('is public for the JWT guard and closed by the API key guard', () => {
    expect(
      Reflect.getMetadata(PUBLIC_METADATA_KEY, MerchantApiPaymentsController),
    ).toBe(true);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MerchantApiPaymentsController),
    ).toEqual([MerchantApiKeyGuard]);
  });

  it('turns the amount string into fiat, hands over the request id and the log details on the request, and keeps 201 for a new deal', async () => {
    const { payments, response, request, payment, call } = build({
      created: true,
      sameRequest: false,
    });

    await expect(call()).resolves.toBe(payment);

    expect(payments.createPayIn).toHaveBeenCalledWith(
      MERCHANT,
      REQUEST_ID,
      expect.objectContaining({
        method: 'sbp',
        amount: toFiat('2000.50'),
        payerInfo: { userId: 'client-1' },
      }),
      request.requestDetails,
    );
    expect(request.requestDetails).toEqual({});
    expect(response.status).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('answers 200 for a repeat, and 200 with X-Same-Request for the same request', async () => {
    const repeat = build({ created: false, sameRequest: false });
    await repeat.call();
    expect(repeat.response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(repeat.response.setHeader).not.toHaveBeenCalled();

    const same = build({ created: false, sameRequest: true });
    await same.call();
    expect(same.response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(same.response.setHeader).toHaveBeenCalledWith(
      'X-Same-Request',
      'true',
    );
  });
});

describe('MerchantApiPaymentsController: reading, canceling and extending', () => {
  const buildReads = () => {
    const payments = {
      listPayments: jest.fn(async () => 'page'),
      findPayment: jest.fn(async () => 'one'),
      findPaymentByMerchantTransactionId: jest.fn(async () => 'by-key'),
      cancelPayment: jest.fn(async () => 'canceled'),
      extendPaymentTimer: jest.fn(async () => 'extended'),
    };
    const controller = new MerchantApiPaymentsController(
      payments as never,
      { getOrThrow: () => 'Europe/Moscow' } as never,
    );

    return { payments, controller };
  };
  const merchant = { merchantId: MERCHANT, apiKeyId: 1 };

  it('maps the list query: sortBy amount to amountFiat, days in the business timezone, search as the reference', async () => {
    const { payments, controller } = buildReads();
    const query = Object.assign(new ListPaymentsQueryDto(), {
      page: 2,
      limit: 10,
      sortOrder: SortOrder.Asc,
      sortBy: PaymentSortField.Amount,
      status: [TransactionStatus.Active, TransactionStatus.Canceled],
      type: TransactionKind.PayIn,
      method: 'sbp',
      createdFrom: '2026-11-01',
      createdTo: '2026-11-02T10:00:00Z',
      search: 'order-7',
    });

    await controller.listPayments(merchant, query);

    expect(payments.listPayments).toHaveBeenCalledWith(MERCHANT, {
      page: 2,
      limit: 10,
      sortBy: TransactionSortField.AmountFiat,
      sortOrder: SortOrder.Asc,
      statuses: [TransactionStatus.Active, TransactionStatus.Canceled],
      kind: TransactionKind.PayIn,
      method: 'sbp',
      createdFrom: new Date('2026-10-31T21:00:00Z'),
      createdTo: new Date('2026-11-02T10:00:00Z'),
      reference: 'order-7',
    });
  });

  it.each([
    [PaymentSortField.CreatedAt, TransactionSortField.CreatedAt],
    [PaymentSortField.ResolvedAt, TransactionSortField.ResolvedAt],
  ])(
    'sorts %s as %s, with no reference for an empty search',
    async (sortBy, expected) => {
      const { payments, controller } = buildReads();
      const query = Object.assign(new ListPaymentsQueryDto(), {
        sortBy,
        search: '',
      });

      await controller.listPayments(merchant, query);

      expect(payments.listPayments).toHaveBeenCalledWith(
        MERCHANT,
        expect.objectContaining({ sortBy: expected, reference: undefined }),
      );
    },
  );

  it('hands every call the merchant from the key, never one from the request', async () => {
    const { payments, controller } = buildReads();

    await controller.findOne(merchant, uuidOf(3));
    await controller.findByMerchantTransactionId(merchant, 'order-1');
    await controller.cancel(merchant, uuidOf(3));
    await controller.extendTimer(merchant, uuidOf(3));

    expect(payments.findPayment).toHaveBeenCalledWith(MERCHANT, uuidOf(3));
    expect(payments.findPaymentByMerchantTransactionId).toHaveBeenCalledWith(
      MERCHANT,
      'order-1',
    );
    expect(payments.cancelPayment).toHaveBeenCalledWith(MERCHANT, uuidOf(3));
    expect(payments.extendPaymentTimer).toHaveBeenCalledWith(
      MERCHANT,
      uuidOf(3),
    );
  });

  it('answers cancel and extend-timer 200, not 201', () => {
    for (const handler of ['cancel', 'extendTimer'] as const) {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          MerchantApiPaymentsController.prototype[handler],
        ),
      ).toBe(HttpStatus.OK);
    }
  });

  it('turns an id that is not a uuid into 404 DEAL_NOT_FOUND', async () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      MerchantApiPaymentsController,
      'findOne',
    ) as Record<string, { data?: string; pipes: PipeTransform[] }>;
    const [pipe] = Object.values(args).find((arg) => arg.data === 'id')!.pipes;

    const refusal = await pipe
      .transform('not-a-uuid', { type: 'param', data: 'id' })
      .catch((error: HttpException) => error);

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect((refusal as HttpException).getResponse()).toEqual({
      code: 'DEAL_NOT_FOUND',
      message: 'Deal not found',
    });
    await expect(
      pipe.transform(uuidOf(3), { type: 'param', data: 'id' }),
    ).resolves.toBe(uuidOf(3));
  });
});

describe('MerchantApiPaymentsController: pay-out creation', () => {
  const build = (created: boolean) => {
    const payment = { id: uuidOf(3) };
    const payments = {
      createPayOut: jest.fn(async () => ({ payment, created })),
    };
    const response = { status: jest.fn(), setHeader: jest.fn() };
    const request = { requestId: REQUEST_ID } as MerchantApiRequest;
    const controller = new MerchantApiPaymentsController(
      payments as never,
      { getOrThrow: () => 'Europe/Moscow' } as never,
    );
    const dto = Object.assign(new CreatePayOutDto(), {
      method: 'card',
      amount: '5000.50',
      merchantTransactionId: 'payout-1',
      requisite: {
        ownerName: 'PETR PETROV',
        bank: 'tbank',
        cardNumber: '4111111111111111',
      },
      timeoutInMin: 30,
    });
    const call = () =>
      controller.payOut(
        { merchantId: MERCHANT, apiKeyId: 1 },
        dto,
        request,
        response as never,
      );

    return { payments, response, request, payment, call };
  };

  it('skips the IP whitelist, and only pay-out creation does', () => {
    const prototype = MerchantApiPaymentsController.prototype;

    expect(
      Reflect.getMetadata(SKIP_IP_CHECK_METADATA_KEY, prototype.payOut),
    ).toBe(true);
    for (const handler of [
      prototype.payIn,
      prototype.findOne,
      prototype.listPayments,
      prototype.cancel,
      prototype.extendTimer,
    ]) {
      expect(
        Reflect.getMetadata(SKIP_IP_CHECK_METADATA_KEY, handler),
      ).toBeUndefined();
    }
  });

  it('turns the amount into fiat, hands over the recipient and the log details, and keeps 201 for a new deal', async () => {
    const { payments, response, request, payment, call } = build(true);

    await expect(call()).resolves.toBe(payment);
    expect(payments.createPayOut).toHaveBeenCalledWith(
      MERCHANT,
      {
        method: 'card',
        amount: toFiat('5000.50'),
        currency: undefined,
        merchantTransactionId: 'payout-1',
        requisite: {
          ownerName: 'PETR PETROV',
          bank: 'tbank',
          cardNumber: '4111111111111111',
        },
        callbackUrl: undefined,
        timeoutInMin: 30,
        payerInfo: undefined,
      },
      request.requestDetails,
    );
    expect(request.requestDetails).toEqual({});
    expect(response.status).not.toHaveBeenCalled();
  });

  it('answers 200 for a repeat', async () => {
    const { response, call } = build(false);

    await call();

    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
  });
});
