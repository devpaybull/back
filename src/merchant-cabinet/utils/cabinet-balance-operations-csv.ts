import { csvField } from '../../common/utils/csv-field';
import { CabinetBalanceOperationDto } from '../dto/cabinet-balance-operation.dto';

const HEADER = [
  'date',
  'type',
  'amount',
  'balanceBefore',
  'balanceAfter',
  'transactionId',
  'withdrawalId',
  'comment',
];
const LINE_BREAK = '\r\n';

export const cabinetBalanceOperationsCsv = (
  rows: CabinetBalanceOperationDto[],
): string =>
  [
    HEADER,
    ...rows.map((row) => [
      row.createdAt.toISOString(),
      row.type,
      row.amount,
      row.balanceBefore,
      row.balanceAfter,
      row.transactionId ?? '',
      row.withdrawalId ?? '',
      row.comment ?? '',
    ]),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
