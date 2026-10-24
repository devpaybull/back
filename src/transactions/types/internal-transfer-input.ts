import { StatusEventSource } from './status-event-source.enum';

export interface InternalTransferInput {
  fromUserId: string;
  toUserId: string;
  amount: number;
  source: StatusEventSource;
  actorUserId?: string | null;
  comment?: string | null;
}
