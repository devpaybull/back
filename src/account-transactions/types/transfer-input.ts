import { Crypto } from '../../common/types/crypto';

export interface TransferInput {
  fromUserId: string;
  toUserId: string;
  amount: Crypto;
  actorUserId: string;
  comment?: string | null;
}
