import { UserStatus } from '../../users/types/user-status.enum';
import { MerchantAttachmentKind } from './merchant-attachment-kind.enum';
import { AttachmentMethodState } from './attachment-method-state';

export interface AttachmentView {
  userId: string;
  login: string;
  status: UserStatus;
  kind: MerchantAttachmentKind;
  trading: boolean;
  methods: AttachmentMethodState[];
}
