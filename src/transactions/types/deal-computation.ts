import { TransactionKind } from './transaction-kind.enum';

export interface DealComputationInput {
  kind: TransactionKind.PayIn | TransactionKind.PayOut;
  amountFiat: number;
  rate: number;
  merchantPercent: number;
  traderPercent: number;
  leadPercent?: number | null;
}

export interface DealComputation {
  amountCrypto: number;
  merchantCommission: number;
  traderCommission: number;
  leadCommission: number | null;
  traderAmount: number;
  merchantAmount: number;
}
