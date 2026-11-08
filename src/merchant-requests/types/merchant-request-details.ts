import { Fiat } from '../../common/types/fiat';
import { SelectionSummary } from '../../transactions/types/selection-summary';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { MerchantRequestOperation } from './merchant-request-operation.enum';

export interface MerchantRequestDetails {
  operation?: MerchantRequestOperation;
  direction?: TransactionKind;
  paymentMethod?: string;
  amountFiat?: Fiat;
  currency?: string | null;
  requestedBankId?: number | null;
  payerUserId?: string;
  counterpartyId?: number;
  merchantTransactionId?: string;
  transactionId?: string | null;
  processedByUserId?: string | null;
  selectionSummary?: SelectionSummary | null;
}
