import { ApiProperty } from '@nestjs/swagger';
import { AttachmentView } from '../../merchants/types/attachment-view';
import { MerchantAttachmentKind } from '../../merchants/types/merchant-attachment-kind.enum';
import {
  MerchantAttachmentDto,
  toMerchantAttachmentDto,
} from './merchant-attachment.dto';

export class MerchantAttachmentsDto {
  @ApiProperty({ type: [MerchantAttachmentDto] })
  traders: MerchantAttachmentDto[];

  @ApiProperty({ type: [MerchantAttachmentDto] })
  cascades: MerchantAttachmentDto[];
}

export const toMerchantAttachmentsDto = (
  views: AttachmentView[],
): MerchantAttachmentsDto => ({
  traders: views
    .filter((view) => view.kind === MerchantAttachmentKind.Trader)
    .map(toMerchantAttachmentDto),
  cascades: views
    .filter((view) => view.kind === MerchantAttachmentKind.Cascade)
    .map(toMerchantAttachmentDto),
});
