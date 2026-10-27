import { ApiProperty } from '@nestjs/swagger';
import { AttachmentView } from '../../merchants/types/attachment-view';
import { UserStatus } from '../../users/types/user-status.enum';
import { AttachmentMethodDto } from './attachment-method.dto';

export class MerchantAttachmentDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  login: string;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty()
  trading: boolean;

  @ApiProperty({ type: [AttachmentMethodDto] })
  methods: AttachmentMethodDto[];
}

export const toMerchantAttachmentDto = (
  view: AttachmentView,
): MerchantAttachmentDto => ({
  userId: view.userId,
  login: view.login,
  status: view.status,
  trading: view.trading,
  methods: view.methods,
});
