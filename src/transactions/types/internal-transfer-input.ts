import { Crypto } from '../../common/types/crypto';
import { StatusEventSource } from './status-event-source.enum';

export interface InternalTransferInput {
  fromUserId: string;
  toUserId: string;
  amount: Crypto;
  source: StatusEventSource;
  actorUserId?: string | null;
  comment?: string | null;
}
