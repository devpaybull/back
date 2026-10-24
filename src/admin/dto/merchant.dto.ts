import { ApiProperty } from '@nestjs/swagger';
import { Merchant } from '../../merchants/entities/merchant.entity';

export class MerchantDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  createdAt: Date;
}

export const toMerchantDto = (row: Merchant): MerchantDto => ({
  id: row.id,
  name: row.name,
  active: row.active,
  createdAt: row.createdAt,
});
