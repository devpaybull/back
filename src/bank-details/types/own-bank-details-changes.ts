import { BankDetailsType } from './bank-details-type.enum';
import { BankDetailsLimits } from './bank-details-limits';

export interface OwnBankDetailsChanges extends Partial<BankDetailsLimits> {
  bankId?: number;
  mobileOperatorId?: number;
  deviceId?: number;
  type?: BankDetailsType;
  cardholderName?: string;
  card?: string;
  phone?: string;
  counterpartyOnly?: boolean;
  maxCounterparties?: number;
  sameBankOnly?: boolean;
  tagIds?: number[];
  reserve?: boolean;
  active?: boolean;
}
