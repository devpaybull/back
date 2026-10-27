import { ApiProperty } from '@nestjs/swagger';
import { MerchantGroupRowDto } from './merchant-group-row.dto';
import { MerchantRowDto } from './merchant-row.dto';

export class MerchantListRowDto {
  @ApiProperty({ enum: ['group', 'merchant'] })
  kind: 'group' | 'merchant';

  @ApiProperty({ type: MerchantGroupRowDto, nullable: true })
  group: MerchantGroupRowDto | null;

  @ApiProperty({ type: MerchantRowDto, nullable: true })
  merchant: MerchantRowDto | null;
}
