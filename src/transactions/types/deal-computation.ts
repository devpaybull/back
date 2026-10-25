import { TransactionKind } from './transaction-kind.enum';

export interface DealLeadPercent {
  leadUserId: string;
  percent: number;
}

export interface DealLeadShare extends DealLeadPercent {
  amount: number;
}

export interface DealComputationInput {
  kind: TransactionKind.PayIn | TransactionKind.PayOut;
  amountFiat: number;
  rate: number;
  merchantPercent: number;
  traderPercent: number;
  platformMinPercent: number;
  leads?: DealLeadPercent[];
}

export interface DealComputation {
  amountCrypto: number;
  merchantCommission: number;
  traderEffectivePercent: number;
  shortfallPercent: number;
  traderCommission: number;
  leadPercent: number | null;
  leadCommission: number | null;
  leadShares: DealLeadShare[];
  traderAmount: number;
  merchantAmount: number;
}
