import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ValidationFailedException } from '../../common/exceptions/validation-failed.exception';
import { NoRequisiteFoundError } from '../../transactions/exceptions/no-requisite-found.exception';
import { MerchantApiExceptionFilter } from '../filters/merchant-api-exception.filter';
import { MerchantApiErrorCode } from '../types/merchant-api-error-code.enum';

const CATALOG: [HttpStatus, MerchantApiErrorCode][] = [
  [HttpStatus.BAD_REQUEST, MerchantApiErrorCode.ValidationFailed],
  [HttpStatus.BAD_REQUEST, MerchantApiErrorCode.MethodNotSupported],
  [HttpStatus.BAD_REQUEST, MerchantApiErrorCode.CurrencyMismatch],
  [HttpStatus.BAD_REQUEST, MerchantApiErrorCode.BankNotFound],
  [HttpStatus.UNAUTHORIZED, MerchantApiErrorCode.InvalidApiKey],
  [HttpStatus.FORBIDDEN, MerchantApiErrorCode.MerchantDisabled],
  [HttpStatus.FORBIDDEN, MerchantApiErrorCode.IpNotAllowed],
  [HttpStatus.FORBIDDEN, MerchantApiErrorCode.MethodDisabled],
  [HttpStatus.FORBIDDEN, MerchantApiErrorCode.AmountBelowMinimum],
  [HttpStatus.FORBIDDEN, MerchantApiErrorCode.PayerBlocked],
  [HttpStatus.FORBIDDEN, MerchantApiErrorCode.FailedDealsLimit],
  [HttpStatus.FORBIDDEN, MerchantApiErrorCode.NoRequisiteFoundForThisAmount],
  [HttpStatus.FORBIDDEN, MerchantApiErrorCode.RateNotFound],
  [HttpStatus.NOT_FOUND, MerchantApiErrorCode.DealNotFound],
  [HttpStatus.CONFLICT, MerchantApiErrorCode.DuplicateMerchantTransactionId],
  [HttpStatus.CONFLICT, MerchantApiErrorCode.InsufficientBalance],
  [HttpStatus.CONFLICT, MerchantApiErrorCode.DealNotCancelable],
  [HttpStatus.CONFLICT, MerchantApiErrorCode.TimerNotExtendable],
  [HttpStatus.CONFLICT, MerchantApiErrorCode.DisputeNotAllowed],
  [HttpStatus.INTERNAL_SERVER_ERROR, MerchantApiErrorCode.InternalError],
  [HttpStatus.SERVICE_UNAVAILABLE, MerchantApiErrorCode.RateUnavailable],
];

describe('MerchantApiExceptionFilter', () => {
  const filter = new MerchantApiExceptionFilter();

  const respond = (exception: unknown) => {
    const json = jest.fn<void, [unknown]>();
    const status = jest.fn<{ json: typeof json }, [number]>(() => ({ json }));
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);

    return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
  };

  let logged: jest.SpyInstance;

  beforeEach(() => {
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => logged.mockRestore());

  it('the catalog is exactly the codes of AC-2.4', () => {
    expect(Object.values(MerchantApiErrorCode).sort()).toEqual(
      CATALOG.map(([, code]) => code).sort(),
    );
  });

  it.each(CATALOG)(
    'answers %s { statusCode, code, message } for %s',
    (statusCode, code) => {
      const exception = new HttpException(
        { code, message: `about ${code}` },
        statusCode,
      );

      expect(respond(exception)).toEqual({
        status: statusCode,
        body: { statusCode, code, message: `about ${code}` },
      });
    },
  );

  it('answers the selection finding nothing with 403 NO_REQUISITE_FOUND_FOR_THIS_AMOUNT, the summary kept out of the body', () => {
    const summary = {
      considered: 3,
      dropped: { device_offline: 3 },
      attempted: 0,
      skippedUnderLock: {},
      issuedBankDetailsId: null,
    };

    expect(respond(new NoRequisiteFoundError(summary))).toEqual({
      status: HttpStatus.FORBIDDEN,
      body: {
        statusCode: HttpStatus.FORBIDDEN,
        code: MerchantApiErrorCode.NoRequisiteFoundForThisAmount,
        message: 'No requisite was found for this amount',
      },
    });
  });

  it('passes details through, such as the deal of a duplicate key', () => {
    const deal = { id: 'd1' };

    expect(
      respond(
        new ConflictException({
          code: MerchantApiErrorCode.DuplicateMerchantTransactionId,
          message: 'Taken',
          details: { deal },
        }),
      ).body,
    ).toEqual({
      statusCode: 409,
      code: 'DUPLICATE_MERCHANT_TRANSACTION_ID',
      message: 'Taken',
      details: { deal },
    });
  });

  it('turns validation errors into VALIDATION_FAILED with a field and a code each', () => {
    const errors: ValidationError[] = [
      {
        property: 'amount',
        constraints: { isFiatAmount: 'amount must be…' },
        children: [],
      },
      {
        property: 'payerInfo',
        children: [
          {
            property: 'userId',
            constraints: {
              isNotEmpty: 'userId should not be empty',
              isString: 'userId must be a string',
            },
            children: [],
          },
        ],
      },
      {
        property: 'counteragent',
        constraints: { whitelistValidation: 'should not exist' },
        children: [],
      },
    ];

    expect(respond(new ValidationFailedException(['…'], errors))).toEqual({
      status: 400,
      body: {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: [
          { field: 'amount', code: 'isFiatAmount' },
          { field: 'payerInfo.userId', code: 'isNotEmpty' },
          { field: 'payerInfo.userId', code: 'isString' },
          { field: 'counteragent', code: 'whitelistValidation' },
        ],
      },
    });
  });

  it('answers a 400 that carries no code as VALIDATION_FAILED without details', () => {
    expect(respond(new BadRequestException('Bad id')).body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Bad id',
    });
  });

  it.each([
    ['an unknown error', new Error('connection refused at 10.0.0.1')],
    ['a thrown string', 'boom'],
    ['an HttpException without a code', new NotFoundException('x')],
    ['an uncoded 401', new UnauthorizedException()],
    [
      'a code outside the catalog',
      new ForbiddenException({ code: 'SOMETHING_ELSE', message: 'x' }),
    ],
    ['an uncoded 503', new ServiceUnavailableException('db down')],
  ])('answers %s as 500 INTERNAL_ERROR, logging it', (_, exception) => {
    expect(respond(exception)).toEqual({
      status: 500,
      body: {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('keeps the stack in the log and out of the body', () => {
    const error = new Error('select * from secrets');

    const { body } = respond(error);

    expect(JSON.stringify(body)).not.toContain('secrets');
    expect(logged).toHaveBeenCalledWith(error.message, error.stack);
  });
});
