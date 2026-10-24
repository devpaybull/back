import { TransactionType } from '../../common/enums/transaction-type.enum';
import { BankDetailsLimits } from './bank-details-limits';

export interface CreateBankDetailsInput extends Partial<BankDetailsLimits> {
  userId: string;
  bankId: number;
  deviceId?: number;
  type: TransactionType;
  cardholderName?: string;
  card?: string;
  phone?: string;
  counterpartyOnly?: boolean;
  reserve?: boolean;
  active?: boolean;
}
