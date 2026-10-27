import { ApiProperty } from '@nestjs/swagger';
import { MerchantGroupView } from '../../merchants/types/merchant-group-view';
import { GroupMerchantDto } from './group-merchant.dto';

export class MerchantGroupDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: [GroupMerchantDto] })
  merchants: GroupMerchantDto[];

  @ApiProperty()
  createdAt: Date;
}

export const toMerchantGroupDto = ({
  group,
  merchants,
}: MerchantGroupView): MerchantGroupDto => ({
  id: group.id,
  name: group.name,
  merchants: merchants.map((merchant) => ({
    id: merchant.id,
    name: merchant.name,
    internalName: merchant.internalName,
  })),
  createdAt: group.createdAt,
});
