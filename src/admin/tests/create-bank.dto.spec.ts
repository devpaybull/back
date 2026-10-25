import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { CreateBankDto } from '../dto/create-bank.dto';

const body = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  bankId: 'kaspi',
  name: 'Kaspi Bank',
  countryId: 1,
  transactionTypes: [TransactionType.Card],
  currencyId: 1,
  ...overrides,
});

const parse = (given: Record<string, unknown>): CreateBankDto =>
  plainToInstance(CreateBankDto, given);

const failedProperties = (given: Record<string, unknown>): string[] =>
  validateSync(parse(given)).map((error) => error.property);

describe('CreateBankDto', () => {
  it('accepts the smallest complete bank', () => {
    expect(failedProperties(body())).toEqual([]);
  });

  it.each(['bankId', 'name', 'countryId', 'transactionTypes', 'currencyId'])(
    'requires %s',
    (field) => {
      expect(failedProperties(body({ [field]: undefined }))).toEqual([field]);
    },
  );

  it('trims the strings, so a pasted value does not become a second bank', () => {
    expect(parse(body({ bankId: '  kaspi  ' })).bankId).toBe('kaspi');
    expect(parse(body({ code: ' KASPIKZKA ' })).code).toBe('KASPIKZKA');
  });

  it('refuses a blank string where a value is expected', () => {
    expect(failedProperties(body({ bankId: '   ' }))).toEqual(['bankId']);
    expect(failedProperties(body({ code: '' }))).toEqual(['code']);
  });

  describe('transactionTypes', () => {
    it('takes both types at once', () => {
      expect(
        failedProperties(
          body({
            transactionTypes: [TransactionType.Card, TransactionType.Sbp],
          }),
        ),
      ).toEqual([]);
    });

    it('refuses an empty list — a bank works with something', () => {
      expect(failedProperties(body({ transactionTypes: [] }))).toEqual([
        'transactionTypes',
      ]);
    });

    it('refuses a type outside the enum', () => {
      expect(failedProperties(body({ transactionTypes: ['p2p'] }))).toEqual([
        'transactionTypes',
      ]);
    });
  });

  describe('the optional fields', () => {
    it('leaves code, cross-border currency and the flags out when absent', () => {
      const parsed = parse(body());

      expect(parsed.code).toBeUndefined();
      expect(parsed.crossBorderCurrencyId).toBeUndefined();
      expect(parsed.active).toBeUndefined();
      expect(parsed.automatic).toBeUndefined();
    });

    it('accepts them when given', () => {
      expect(
        failedProperties(
          body({
            code: 'KASPIKZKA',
            crossBorderCurrencyId: 2,
            active: false,
            automatic: true,
          }),
        ),
      ).toEqual([]);
    });

    it('refuses a flag that is not a boolean', () => {
      expect(failedProperties(body({ active: 'yes' }))).toEqual(['active']);
    });
  });
});
