import { StatusEventSource } from './status-event-source.enum';

export interface PayoutTaker {
  source: StatusEventSource;
  actorUserId: string;
  impersonatorUserId: string | null;
  assignedBy: string;
  action: string;
  admin: { confirmOverdraft: boolean } | null;
}
