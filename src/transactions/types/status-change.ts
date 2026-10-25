import { StatusEventSource } from './status-event-source.enum';
import { TransactionStatus } from './transaction-status.enum';

export interface StatusChange {
  toStatus: TransactionStatus;
  source: StatusEventSource;
  actorUserId?: string | null;
  reason?: string | null;
}
