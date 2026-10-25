import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { MethodRate } from '../../transactions/entities/method-rate.entity';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { RateSetDto, toRateSetDto } from '../dto/rate-set.dto';

const parse = (body: Record<string, unknown>): RateSetDto =>
  plainToInstance(RateSetDto, body);

const failedPaths = (body: Record<string, unknown>): string[] => {
  const walk = (errors: ValidationError[], prefix: string): string[] =>
    errors.flatMap((error) => {
      const path = prefix ? `${prefix}.${error.property}` : error.property;

      return error.children?.length ? walk(error.children, path) : [path];
    });

  return walk(
    validateSync(parse(body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
    '',
  );
};

const percent = { payInPercent: 5, payOutPercent: 2 };

describe('RateSetDto', () => {
  it.each(TRANSACTION_METHOD_CODES)('accepts the method %s', (method) => {
    expect(failedPaths({ methods: [{ method, bands: [] }] })).toEqual([]);
  });

  it('refuses a code the registry does not know', () => {
    expect(failedPaths({ methods: [{ method: 'qr', bands: [] }] })).toEqual([
      'methods.0.method',
    ]);
  });

  it('needs neither bands nor banks and treats both as empty', () => {
    const dto = parse({ methods: [{ method: 'sbp', general: percent }] });

    expect(
      failedPaths({ methods: [{ method: 'sbp', general: percent }] }),
    ).toEqual([]);
    expect(dto.methods[0].bands).toEqual([]);
    expect(dto.methods[0].banks).toEqual([]);
  });

  it('accepts a bank row of a bank id and two percents', () => {
    expect(
      failedPaths({
        methods: [{ method: 'sbp', banks: [{ bankId: 3, ...percent }] }],
      }),
    ).toEqual([]);
  });

  it('refuses a bank row without a positive integer bank id', () => {
    expect(
      failedPaths({
        methods: [
          {
            method: 'sbp',
            banks: [
              { bankId: 0, ...percent },
              { bankId: 1.5, ...percent },
              { ...percent },
            ],
          },
        ],
      }),
    ).toEqual([
      'methods.0.banks.0.bankId',
      'methods.0.banks.1.bankId',
      'methods.0.banks.2.bankId',
    ]);
  });

  it('refuses a negative percent on a bank row', () => {
    expect(
      failedPaths({
        methods: [
          {
            method: 'sbp',
            banks: [{ bankId: 1, payInPercent: -1, payOutPercent: 2 }],
          },
        ],
      }),
    ).toEqual(['methods.0.banks.0.payInPercent']);
  });
});

describe('toRateSetDto', () => {
  const row = (overrides: Partial<MethodRate>): MethodRate =>
    ({
      method: 'sbp',
      fromAmount: null,
      toAmount: null,
      bankId: null,
      ...percent,
      ...overrides,
    }) as MethodRate;

  it('splits the rows of a method into the general rate, bands and bank rows', () => {
    expect(
      toRateSetDto([
        row({}),
        row({ fromAmount: 0, toAmount: 100, payInPercent: 4 }),
        row({ bankId: 7, payInPercent: 3 }),
      ]),
    ).toEqual({
      methods: [
        {
          method: 'sbp',
          general: percent,
          bands: [
            { fromAmount: 0, toAmount: 100, payInPercent: 4, payOutPercent: 2 },
          ],
          banks: [{ bankId: 7, payInPercent: 3, payOutPercent: 2 }],
        },
      ],
    });
  });

  it('gives a method without a general row a null general and empty lists', () => {
    expect(toRateSetDto([row({ method: 'card', bankId: 1 })])).toEqual({
      methods: [
        {
          method: 'card',
          general: null,
          bands: [],
          banks: [{ bankId: 1, ...percent }],
        },
      ],
    });
  });
});
