import { Crypto } from '../../common/types/crypto';

export interface ChangedLeadShare {
  shareId: number;
  amount: Crypto;
}

export interface ChangedDealFigures {
  amountCrypto: Crypto;
  merchantCommission: Crypto;
  traderCommission: Crypto;
  leadCommission: Crypto | null;
  traderAmount: Crypto;
  merchantAmount: Crypto;
  leadShares: ChangedLeadShare[];
}
