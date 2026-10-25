import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';
import { BalanceOperationFilterDto } from '../dto/balance-operation-filter.dto';
import { ListBalanceOperationsQueryDto } from '../dto/list-balance-operations-query.dto';

const parse = async <T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) => {
  const dto = plainToInstance(cls, plain);

  return { dto, errors: await validate(dto) };
};

describe('ListBalanceOperationsQueryDto', () => {
  it('defaults to the first page of twenty, newest first', async () => {
    const { dto, errors } = await parse(ListBalanceOperationsQueryDto, {});

    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ page: 1, limit: 20, sortOrder: 'desc' });
  });

  it('refuses a limit over 100 instead of clamping it', async () => {
    const { errors } = await parse(ListBalanceOperationsQueryDto, {
      limit: '101',
    });

    expect(errors.map((e) => e.property)).toEqual(['limit']);
  });

  it('parses dates, a comma-separated type list and a kind', async () => {
    const { dto, errors } = await parse(ListBalanceOperationsQueryDto, {
      from: '2026-10-01T00:00:00Z',
      to: '2026-11-01',
      type: 'transaction, debt_issued',
      kind: 'insurance_pay_in',
    });

    expect(errors).toEqual([]);
    expect(dto.from).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(dto.to).toEqual(new Date('2026-11-01'));
    expect(dto.type).toEqual([
      BalanceOperationType.Transaction,
      BalanceOperationType.DebtIssued,
    ]);
    expect(dto.kind).toBe(BalanceKind.InsurancePayIn);
  });

  it('accepts a repeated type parameter and a single type', async () => {
    const repeated = await parse(BalanceOperationFilterDto, {
      type: ['internal', 'transaction'],
    });
    const single = await parse(BalanceOperationFilterDto, { type: 'internal' });

    expect(repeated.dto.type).toEqual(['internal', 'transaction']);
    expect(single.dto.type).toEqual(['internal']);
  });

  it('rejects an unknown type, an unknown kind and a bad date', async () => {
    const type = await parse(BalanceOperationFilterDto, { type: 'deposit' });
    const kind = await parse(BalanceOperationFilterDto, { kind: 'bonus' });
    const date = await parse(BalanceOperationFilterDto, { from: 'yesterday' });

    expect(type.errors.map((e) => e.property)).toEqual(['type']);
    expect(kind.errors.map((e) => e.property)).toEqual(['kind']);
    expect(date.errors.map((e) => e.property)).toEqual(['from']);
  });
});
