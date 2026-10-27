import { ApiProperty } from '@nestjs/swagger';

export class GroupMerchantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  internalName: string | null;
}
