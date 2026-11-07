import { csvField } from '../../common/utils/csv-field';
import { TraderDealDto } from '../dto/trader-deal.dto';

const HEADER = [
  'id',
  'status',
  'method',
  'createdAt',
  'resolvedAt',
  'amountFiat',
  'currency',
  'rate',
  'bank',
  'requisite',
  'counterpartyId',
  'merchantGroup',
  'profit',
  'profitFiat',
];
const LINE_BREAK = '\r\n';

export const traderDealsCsv = (rows: TraderDealDto[]): string =>
  [
    HEADER,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.method ?? '',
      row.createdAt.toISOString(),
      row.resolvedAt?.toISOString() ?? '',
      row.amountFiat,
      row.currency ?? '',
      row.rate,
      row.requisite?.bank?.name ?? row.requisite?.mobileOperator?.name ?? '',
      row.requisite?.phone ?? row.requisite?.card ?? '',
      row.counterpartyId,
      row.merchantGroup?.name ?? '',
      row.profit,
      row.profitFiat,
    ]),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
