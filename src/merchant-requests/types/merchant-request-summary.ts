import { Fiat } from '../../common/types/fiat';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { MerchantRequestOperation } from './merchant-request-operation.enum';
import { MerchantRequestResult } from './merchant-request-result.enum';

export interface MerchantRequestSummary {
  id: string;
  merchantId: string;
  statusCode: number;
  errorCode: string | null;
  durationMs: number;
  result: MerchantRequestResult;
  operation: MerchantRequestOperation | null;
  direction: TransactionKind | null;
  paymentMethod: string | null;
  amountFiat: Fiat | null;
  currency: string | null;
  requestedBankId: number | null;
  payerUserId: string | null;
  merchantTransactionId: string | null;
  transactionId: string | null;
  processedByUserId: string | null;
  counterpartyId: number | null;
  receivedAt: Date;
}
