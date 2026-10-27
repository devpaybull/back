import { AttachmentMethodState } from './attachment-method-state';

export interface AttachmentChanges {
  trading?: boolean;
  methods?: AttachmentMethodState[];
}
