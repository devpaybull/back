import { TransactionType } from '../../common/enums/transaction-type.enum';
import { BankDetailsLimits } from './bank-details-limits';

export interface OwnBankDetailsChanges extends Partial<BankDetailsLimits> {
  bankId?: number;
  deviceId?: number;
  type?: TransactionType;
  cardholderName?: string;
  card?: string;
  phone?: string;
  counterpartyOnly?: boolean;
  reserve?: boolean;
  active?: boolean;
}
