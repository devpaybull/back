import { TransactionMethod } from './transaction-method.enum';

export interface RateBandEntry {
  fromAmount: number;
  toAmount: number;
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
}

export interface RateAudit {
  actorUserId: string;
}
