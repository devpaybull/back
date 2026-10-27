import { ApiProperty } from '@nestjs/swagger';
import { AttachmentCountsDto } from './attachment-counts.dto';
import { MerchantMethodsDto } from './merchant-methods.dto';

export class MerchantRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  internalName: string | null;

  @ApiProperty({ type: Number, nullable: true })
  groupId: number | null;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ description: 'the «Искл. залив» flag' })
  exclusiveTopUp: boolean;

  @ApiProperty({ type: String, example: '50000.500000' })
  balance: string;

  @ApiProperty({ type: MerchantMethodsDto })
  methods: MerchantMethodsDto;

  @ApiProperty({ type: AttachmentCountsDto })
  attachments: AttachmentCountsDto;

  @ApiProperty()
  createdAt: Date;
}
