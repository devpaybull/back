import { csvField } from '../../common/utils/csv-field';
import { MerchantDealDto } from '../dto/merchant-deal.dto';

const HEADER = [
  'id',
  'kind',
  'status',
  'method',
  'createdAt',
  'resolvedAt',
  'amountFiat',
  'currency',
  'rate',
  'amountCrypto',
  'merchantCommission',
  'merchantAmount',
  'bank',
  'requisite',
];
const LINE_BREAK = '\r\n';

export const merchantDealsCsv = (rows: MerchantDealDto[]): string =>
  [
    HEADER,
    ...rows.map((row) => [
      row.id,
      row.kind,
      row.status,
      row.method ?? '',
      row.createdAt.toISOString(),
      row.resolvedAt?.toISOString() ?? '',
      row.amountFiat,
      row.currency ?? '',
      row.rate,
      row.amountCrypto,
      row.merchantCommission,
      row.merchantAmount,
      row.requisite?.bank?.name ?? row.requisite?.mobileOperator?.name ?? '',
      row.requisite?.phone ?? row.requisite?.card ?? '',
    ]),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
