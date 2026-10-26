import { Crypto } from '../../common/types/crypto';

export interface UsdtTransferEvent {
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  amount: Crypto;
  blockNumber: number;
  blockTime: Date;
}
