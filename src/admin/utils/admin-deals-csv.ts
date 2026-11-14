import { csvField } from '../../common/utils/csv-field';
import { TransactionListItemDto } from '../dto/transaction-list-item.dto';

const HEADER = [
  'id',
  'merchantTransactionId',
  'kind',
  'method',
  'status',
  'createdAt',
  'resolvedAt',
  'amountFiat',
  'currency',
  'amountCrypto',
  'rate',
  'merchantPercent',
  'merchantCommission',
  'traderPercent',
  'traderCommission',
  'leadCommission',
  'trader',
  'merchant',
  'bank',
  'holder',
  'cardOrPhone',
  'counterpartyId',
  'payerUserId',
];
const LINE_BREAK = '\r\n';

export interface AdminDealCsvRow extends TransactionListItemDto {
  currency: string | null;
  payerUserId: string | null;
}

export const adminDealsCsv = (rows: AdminDealCsvRow[]): string =>
  [
    HEADER,
    ...rows.map((row) => {
      const requisite = row.bankDetails;
      const recipient = row.recipient;

      return [
        row.id,
        row.merchantTransactionId,
        row.kind,
        row.method,
        row.status,
        row.createdAt.toISOString(),
        row.resolvedAt?.toISOString() ?? null,
        row.amountFiat,
        row.currency,
        row.amountCrypto,
        row.rate,
        row.merchantPercent,
        row.merchantCommission,
        row.traderEffectivePercent ?? row.traderPercent,
        row.traderCommission,
        row.leadCommission,
        row.trader?.login ?? null,
        row.merchant?.name ?? null,
        requisite?.bank?.name ??
          requisite?.mobileOperator?.name ??
          recipient?.bank?.name ??
          null,
        requisite?.cardholderName ?? recipient?.ownerName ?? null,
        requisite?.card ??
          requisite?.phone ??
          recipient?.cardNumber ??
          recipient?.phone ??
          null,
        row.counterparty?.id ?? null,
        row.payerUserId,
      ];
    }),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
