import { ApiProperty } from '@nestjs/swagger';
import { MerchantApiKey } from '../../merchants/entities/merchant-api-key.entity';

export class MerchantApiKeySummaryDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  key: string;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: Date, nullable: true })
  revokedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export const toMerchantApiKeySummaryDto = (
  row: MerchantApiKey,
): MerchantApiKeySummaryDto => ({
  id: row.id,
  key: row.key,
  active: row.active,
  revokedAt: row.revokedAt ?? null,
  createdAt: row.createdAt,
});
