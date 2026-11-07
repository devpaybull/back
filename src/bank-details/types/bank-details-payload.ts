import { BankDetailsType } from './bank-details-type.enum';

export interface BankDetailsPayload {
  type: BankDetailsType;
  bankId: number | null;
  mobileOperatorId: number | null;
  card: string | null;
  phone: string | null;
}
