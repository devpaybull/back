import { MerchantBalanceOperationDto } from '../dto/merchant-balance-operation.dto';
import { csvField } from './csv-field';

const HEADER = [
  'date',
  'type',
  'amount',
  'balanceBefore',
  'balanceAfter',
  'escrowBefore',
  'escrowAfter',
  'transactionId',
  'comment',
];
const LINE_BREAK = '\r\n';

export const merchantBalanceOperationsCsv = (
  rows: MerchantBalanceOperationDto[],
): string =>
  [
    HEADER,
    ...rows.map((row) => [
      row.createdAt.toISOString(),
      row.type,
      row.amount,
      row.balanceBefore,
      row.balanceAfter,
      row.escrowBefore,
      row.escrowAfter,
      row.transactionId ?? '',
      row.comment ?? '',
    ]),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
