import { Fiat } from '../../common/types/fiat';
import { BankDetailsType } from './bank-details-type.enum';

export interface RequisiteCandidate {
  id: string;
  userId: string;
  type: BankDetailsType;
  bankId: number | null;
  bankCurrency: string | null;
  mobileOperatorId: number | null;
  card: string | null;
  phone: string | null;
  deviceId: number;
  deviceOnline: boolean;
  active: boolean;
  banned: boolean;
  counterpartyOnly: boolean;
  reserve: boolean;
  sameBankOnly: boolean;
  maxCounterparties: number | null;
  minAmount: Fiat | null;
  maxAmount: Fiat | null;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailyAmountLimit: Fiat | null;
  monthlyAmountLimit: Fiat | null;
  hourlyAmountLimit: Fiat | null;
  maxActiveTransactions: number | null;
  delayBetweenRequestsSeconds: number | null;
}
