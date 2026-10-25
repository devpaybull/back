import { Crypto } from '../../common/types/crypto';
import { Fiat } from '../../common/types/fiat';
import { Rate } from '../../common/types/rate';
import { TransactionKind } from './transaction-kind.enum';

export interface DealLeadPercent {
  leadUserId: string;
  percent: number;
}

export interface DealLeadShare extends DealLeadPercent {
  amount: Crypto;
}

export interface DealComputationInput {
  kind: TransactionKind.PayIn | TransactionKind.PayOut;
  amountFiat: Fiat;
  rate: Rate;
  merchantPercent: number;
  traderPercent: number;
  platformMinPercent: number;
  leads?: DealLeadPercent[];
}

export interface DealComputation {
  amountCrypto: Crypto;
  merchantCommission: Crypto;
  traderEffectivePercent: number;
  shortfallPercent: number;
  traderCommission: Crypto;
  leadPercent: number | null;
  leadCommission: Crypto | null;
  leadShares: DealLeadShare[];
  traderAmount: Crypto;
  merchantAmount: Crypto;
}
