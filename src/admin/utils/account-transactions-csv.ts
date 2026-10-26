import { csvField } from './csv-field';

export interface AccountTransactionCsvRow {
  id: number;
  status: string;
  statusReason: string | null;
  login: string | null;
  address: string | null;
  amount: string | null;
  fee: string | null;
  txHash: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

const HEADER = [
  'id',
  'status',
  'statusReason',
  'user',
  'address',
  'amount',
  'fee',
  'txHash',
  'createdAt',
  'completedAt',
];
const LINE_BREAK = '\r\n';

export const accountTransactionsCsv = (
  rows: AccountTransactionCsvRow[],
): string =>
  [
    HEADER,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.statusReason,
      row.login,
      row.address,
      row.amount,
      row.fee,
      row.txHash,
      row.createdAt.toISOString(),
      row.completedAt?.toISOString() ?? null,
    ]),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
