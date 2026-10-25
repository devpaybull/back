import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DebtEventSortField } from '../../debts/types/debt-event-sort-field.enum';
import { DebtSortField } from '../../debts/types/debt-sort-field.enum';
import { DebtStatus } from '../../debts/types/debt-status.enum';
import { ListDebtEventsQueryDto } from '../dto/list-debt-events-query.dto';
import { ListDebtsQueryDto } from '../dto/list-debts-query.dto';

const parse = (payload: Record<string, unknown>) =>
  plainToInstance(ListDebtsQueryDto, payload);

const failedProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(parse(payload)).map((error) => error.property);

describe('ListDebtsQueryDto', () => {
  it('sorts by createdAt by default', () => {
    expect(parse({}).sortBy).toBe(DebtSortField.CreatedAt);
    expect(failedProperties({})).toEqual([]);
  });

  it.each(Object.values(DebtSortField))('sorts by %s', (sortBy) => {
    expect(failedProperties({ sortBy })).toEqual([]);
  });

  it('refuses a column outside the sortable set', () => {
    expect(failedProperties({ sortBy: 'comment' })).toEqual(['sortBy']);
  });

  it.each(Object.values(DebtStatus))('filters by status %s', (status) => {
    expect(failedProperties({ status })).toEqual([]);
  });

  it('refuses an unknown status', () => {
    expect(failedProperties({ status: 'closed' })).toEqual(['status']);
  });

  it('refuses a userId that is not a uuid', () => {
    expect(failedProperties({ userId: '42' })).toEqual(['userId']);
  });
});

describe('ListDebtEventsQueryDto', () => {
  it('sorts by createdAt by default and refuses an unknown column', () => {
    expect(plainToInstance(ListDebtEventsQueryDto, {}).sortBy).toBe(
      DebtEventSortField.CreatedAt,
    );
    expect(
      validateSync(
        plainToInstance(ListDebtEventsQueryDto, { sortBy: 'amount' }),
      ).map((error) => error.property),
    ).toEqual(['sortBy']);
  });
});
