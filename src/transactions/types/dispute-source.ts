import { StatusEventSource } from './status-event-source.enum';

export interface DisputeSource {
  source: StatusEventSource;
  actorUserId: string | null;
}
