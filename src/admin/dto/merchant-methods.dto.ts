import { ApiProperty } from '@nestjs/swagger';
import { MerchantMethodChipDto } from './merchant-method-chip.dto';

export class MerchantMethodsDto {
  @ApiProperty({ type: [MerchantMethodChipDto] })
  payIn: MerchantMethodChipDto[];

  @ApiProperty({ type: [MerchantMethodChipDto] })
  payOut: MerchantMethodChipDto[];
}
