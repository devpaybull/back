import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';

export interface BindableRequisite {
  id: string;
  type: BankDetailsType;
  card: string | null;
  phone: string | null;
  counterpartyOnly: boolean;
  maxCounterparties: number | null;
  userId: string;
}
