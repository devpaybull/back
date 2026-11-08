import { Crypto } from '../../common/types/crypto';
import { Fiat } from '../../common/types/fiat';

export interface TraderStatsSummary {
  issued: number;
  skipped: number;
  paid: number;
  canceled: number;
  successCount: number;
  turnover: Fiat;
  volumeCrypto: Crypto;
  income: Crypto;
  depositSeconds: number | null;
  payoutSeconds: number | null;
  disputeSeconds: number | null;
}
