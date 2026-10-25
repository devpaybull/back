import { TransactionType } from '../../common/enums/transaction-type.enum';

export interface BankChanges {
  bankId?: string;
  name?: string;
  code?: string;
  countryId?: number;
  transactionTypes?: TransactionType[];
  currencyId?: number;
  crossBorderCurrencyId?: number;
  active?: boolean;
  automatic?: boolean;
}
