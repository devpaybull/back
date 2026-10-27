import { AttachmentMethodState } from './attachment-method-state';

export interface AttachmentEntry {
  userId: string;
  trading: boolean;
  methods: AttachmentMethodState[];
}
