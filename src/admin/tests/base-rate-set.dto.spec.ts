import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { BaseRateSetDto } from '../dto/base-rate-set.dto';

const failedPaths = (body: Record<string, unknown>): string[] => {
  const walk = (errors: ValidationError[], prefix: string): string[] =>
    errors.flatMap((error) => {
      const path = prefix ? `${prefix}.${error.property}` : error.property;

      return error.children?.length ? walk(error.children, path) : [path];
    });

  return walk(
    validateSync(plainToInstance(BaseRateSetDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
    '',
  );
};

const percent = { payInPercent: 5, payOutPercent: 2 };

describe('BaseRateSetDto', () => {
  it.each(TRANSACTION_METHOD_CODES)('accepts the method %s', (method) => {
    expect(failedPaths({ methods: [{ method, ...percent }] })).toEqual([]);
  });

  it('refuses a code the registry does not know', () => {
    expect(failedPaths({ methods: [{ method: 'qr', ...percent }] })).toEqual([
      'methods.0.method',
    ]);
  });

  it('holds general rates only: bands and bank rows are unknown properties', () => {
    expect(
      failedPaths({
        methods: [
          {
            method: 'sbp',
            ...percent,
            bands: [{ fromAmount: 0, toAmount: 1, ...percent }],
            banks: [{ bankId: 1, ...percent }],
            bankId: 1,
            fromAmount: 0,
            toAmount: 1,
          },
        ],
      }),
    ).toEqual([
      'methods.0.bands',
      'methods.0.banks',
      'methods.0.bankId',
      'methods.0.fromAmount',
      'methods.0.toAmount',
    ]);
  });
});
