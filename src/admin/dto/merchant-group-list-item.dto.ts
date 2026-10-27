import { ApiProperty } from '@nestjs/swagger';
import { MerchantGroupSummary } from '../../merchants/types/merchant-group-summary';

export class MerchantGroupListItemDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  merchantCount: number;

  @ApiProperty()
  createdAt: Date;
}

export const toMerchantGroupListItemDto = ({
  group,
  merchantCount,
}: MerchantGroupSummary): MerchantGroupListItemDto => ({
  id: group.id,
  name: group.name,
  merchantCount,
  createdAt: group.createdAt,
});
