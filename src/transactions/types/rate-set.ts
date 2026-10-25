import { Fiat } from '../../common/types/fiat';
import { TransactionMethod } from './transaction-method';

export interface RateBandEntry {
  fromAmount: Fiat;
  toAmount: Fiat;
  payInPercent: number;
  payOutPercent: number;
}

export interface RateBankEntry {
  bankId: number;
  payInPercent: number;
  payOutPercent: number;
}

export interface RateGeneral {
  payInPercent: number;
  payOutPercent: number;
}

export interface BaseMethodRate {
  method: TransactionMethod;
  payInPercent: number;
  payOutPercent: number;
}

export interface SubjectMethodRates {
  method: TransactionMethod;
  general: RateGeneral | null;
  bands: RateBandEntry[];
  banks: RateBankEntry[];
}

export interface RateAudit {
  actorUserId: string;
}

export interface LeadRateAudit extends RateAudit {
  traderUserId: string;
  leadUserId: string;
}
