import { csvField } from '../../common/utils/csv-field';
import { TraderPayoutDto } from '../dto/trader-payout.dto';

const HEADER = [
  'id',
  'status',
  'method',
  'createdAt',
  'takenAt',
  'completedAt',
  'resolvedAt',
  'amountFiat',
  'currency',
  'rate',
  'bank',
  'ownerName',
  'recipient',
  'merchantGroup',
  'traderAmount',
  'profit',
  'profitFiat',
];
const LINE_BREAK = '\r\n';

export const traderPayoutsCsv = (rows: TraderPayoutDto[]): string =>
  [
    HEADER,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.method ?? '',
      row.createdAt.toISOString(),
      row.takenAt?.toISOString() ?? '',
      row.completedAt?.toISOString() ?? '',
      row.resolvedAt?.toISOString() ?? '',
      row.amountFiat,
      row.currency ?? '',
      row.rate,
      row.recipient.bank?.name ?? '',
      row.recipient.ownerName ?? '',
      row.recipient.cardNumber ?? row.recipient.phone ?? '',
      row.merchantGroup?.name ?? '',
      row.traderAmount,
      row.profit,
      row.profitFiat,
    ]),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
