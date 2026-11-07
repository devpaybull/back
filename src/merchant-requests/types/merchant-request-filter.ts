import { Fiat } from '../../common/types/fiat';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { MerchantRequestOperation } from './merchant-request-operation.enum';
import { MerchantRequestResult } from './merchant-request-result.enum';

export interface MerchantRequestFilter {
  result?: MerchantRequestResult;
  merchantId?: string;
  receivedFrom?: Date | null;
  receivedBefore?: Date;
  amountFrom?: Fiat;
  amountTo?: Fiat;
  requestedBankId?: number | null;
  paymentMethod?: string;
  direction?: TransactionKind;
  operations?: readonly MerchantRequestOperation[];
  search?: string;
  searchMerchantIds?: readonly string[];
}
