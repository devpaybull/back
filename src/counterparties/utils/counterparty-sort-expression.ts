import { CounterpartySortField } from '../types/counterparty-sort-field.enum';
import { windowVolumeSql } from './window-volume-sql';

const EXPRESSIONS: Record<CounterpartySortField, string> = {
  [CounterpartySortField.Id]: '"counterparty"."id"',
  [CounterpartySortField.CreatedAt]: '"counterparty"."createdAt"',
  [CounterpartySortField.ExternalId]: '"counterparty"."externalId"',
  [CounterpartySortField.Activity]: '"counterparty"."paidCount"',
  [CounterpartySortField.Conversion]:
    'CASE WHEN "counterparty"."completedCount" = 0 THEN NULL ELSE "counterparty"."paidCount"::numeric / "counterparty"."completedCount" END',
  [CounterpartySortField.AverageCheck]:
    'CASE WHEN "counterparty"."paidCount" = 0 THEN NULL ELSE "counterparty"."paidAmount" / "counterparty"."paidCount" END',
  [CounterpartySortField.Volume7d]: windowVolumeSql(7, 'paidAmount'),
  [CounterpartySortField.Volume30d]: windowVolumeSql(30, 'paidAmount'),
  [CounterpartySortField.VolumeTotal]: '"counterparty"."paidAmount"',
};

export function counterpartySortExpression(
  field: CounterpartySortField,
): string {
  return EXPRESSIONS[field];
}
