import { csvField } from './csv-field';
import { BalanceOperationDto } from '../dto/balance-operation.dto';

const HEADER = [
  'date',
  'type',
  'kind',
  'amount',
  'balanceBefore',
  'balanceAfter',
  'reference',
];
const LINE_BREAK = '\r\n';

const referenceOf = ({ reference }: BalanceOperationDto): string => {
  if (reference?.debtId != null) return `debt:${reference.debtId}`;
  if (reference?.transactionId) return `transaction:${reference.transactionId}`;
  if (reference?.accountTransactionId != null) {
    return `account_transaction:${reference.accountTransactionId}`;
  }

  return '';
};

export const balanceOperationsCsv = (rows: BalanceOperationDto[]): string =>
  [
    HEADER,
    ...rows.map((row) => [
      row.createdAt.toISOString(),
      row.type,
      row.kind,
      row.amount,
      row.balanceBefore,
      row.balanceAfter,
      referenceOf(row),
    ]),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
