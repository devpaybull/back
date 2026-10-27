import { ApiProperty } from '@nestjs/swagger';
import { MerchantCurrencyDto } from './merchant-currency.dto';
import { MerchantKpiDto } from './merchant-kpi.dto';
import { MerchantRowDto } from './merchant-row.dto';
import { MerchantSettingsDto } from './merchant-settings.dto';

export class MerchantCardGroupDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;
}

export class MerchantCardDto extends MerchantRowDto {
  @ApiProperty({ type: MerchantCardGroupDto, nullable: true })
  group: MerchantCardGroupDto | null;

  @ApiProperty({
    type: String,
    example: '400.000000',
    description: 'held for pay-outs not yet finished; not part of balance',
  })
  escrow: string;

  @ApiProperty({ type: [MerchantCurrencyDto] })
  currencies: MerchantCurrencyDto[];

  @ApiProperty({ type: MerchantSettingsDto })
  settings: MerchantSettingsDto;

  @ApiProperty({ type: MerchantKpiDto })
  kpi: MerchantKpiDto;

  @ApiProperty()
  updatedAt: Date;
}
