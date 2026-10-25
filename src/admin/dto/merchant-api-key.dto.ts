import { ApiProperty } from '@nestjs/swagger';
import { MerchantApiKey } from '../../merchants/entities/merchant-api-key.entity';

export class MerchantApiKeyDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  merchantId: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  secret: string;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ nullable: true })
  revokedAt: Date;

  @ApiProperty()
  createdAt: Date;
}

export const toMerchantApiKeyDto = (
  row: MerchantApiKey,
): MerchantApiKeyDto => ({
  id: row.id,
  merchantId: row.merchantId,
  key: row.key,
  secret: row.secret,
  active: row.active,
  revokedAt: row.revokedAt,
  createdAt: row.createdAt,
});
