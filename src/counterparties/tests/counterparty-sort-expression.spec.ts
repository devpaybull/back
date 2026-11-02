import { CounterpartySortField } from '../types/counterparty-sort-field.enum';
import { counterpartySortExpression } from '../utils/counterparty-sort-expression';

describe('counterpartySortExpression', () => {
  it.each(Object.values(CounterpartySortField))(
    'maps %s to a non-empty expression',
    (field) => {
      expect(counterpartySortExpression(field)).toEqual(expect.any(String));
      expect(counterpartySortExpression(field).length).toBeGreaterThan(0);
    },
  );

  it.each([
    [CounterpartySortField.Id, '"counterparty"."id"'],
    [CounterpartySortField.CreatedAt, '"counterparty"."createdAt"'],
    [CounterpartySortField.ExternalId, '"counterparty"."externalId"'],
    [CounterpartySortField.Activity, '"counterparty"."paidCount"'],
    [CounterpartySortField.VolumeTotal, '"counterparty"."paidAmount"'],
  ])('maps %s to the plain column %s', (field, column) => {
    expect(counterpartySortExpression(field)).toBe(column);
  });

  it('guards conversion against a zero completed count', () => {
    expect(
      counterpartySortExpression(CounterpartySortField.Conversion),
    ).toMatch(/WHEN "counterparty"\."completedCount" = 0 THEN NULL/);
  });

  it('guards the average check against a zero paid count', () => {
    expect(
      counterpartySortExpression(CounterpartySortField.AverageCheck),
    ).toMatch(/WHEN "counterparty"\."paidCount" = 0 THEN NULL/);
  });

  it('sorts the seven day volume over the seven day window', () => {
    expect(
      counterpartySortExpression(CounterpartySortField.Volume7d),
    ).toContain(':since7');
  });

  it('sorts the thirty day volume over the thirty day window', () => {
    expect(
      counterpartySortExpression(CounterpartySortField.Volume30d),
    ).toContain(':since30');
  });
});
