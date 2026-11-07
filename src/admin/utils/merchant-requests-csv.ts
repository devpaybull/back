import { csvField } from '../../common/utils/csv-field';
import { MerchantRequestDto } from '../dto/merchant-request.dto';

const HEADER = [
  'receivedAt',
  'id',
  'merchantId',
  'merchant',
  'operation',
  'direction',
  'method',
  'amount',
  'currency',
  'bank',
  'payerUserId',
  'merchantTransactionId',
  'result',
  'statusCode',
  'errorCode',
  'processedBy',
  'durationMs',
  'transactionId',
];
const LINE_BREAK = '\r\n';

export const merchantRequestsCsv = (rows: MerchantRequestDto[]): string =>
  [
    HEADER,
    ...rows.map((row) => [
      row.receivedAt.toISOString(),
      row.id,
      row.merchant.id,
      row.merchant.name,
      row.operation,
      row.direction,
      row.method,
      row.amount,
      row.currency,
      row.bank?.code ?? null,
      row.payerUserId,
      row.merchantTransactionId,
      row.result,
      row.statusCode,
      row.errorCode,
      row.processedBy?.login ?? null,
      row.durationMs,
      row.transactionId,
    ]),
  ]
    .map((line) => line.map(csvField).join(','))
    .join(LINE_BREAK)
    .concat(LINE_BREAK);
