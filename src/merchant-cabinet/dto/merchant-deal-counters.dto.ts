import { ApiProperty } from '@nestjs/swagger';

export class MerchantDealTabsDto {
  @ApiProperty() all: number;
  @ApiProperty() active: number;
  @ApiProperty() pending: number;
  @ApiProperty({ description: 'dispute + manual_review' }) dispute: number;
  @ApiProperty() checking: number;
  @ApiProperty() checking_manually: number;
  @ApiProperty() success_changed: number;
  @ApiProperty() success: number;
  @ApiProperty() canceled: number;
}

export class MerchantDealKpiDto {
  @ApiProperty({ description: '«Активные»: active, now' })
  active: number;

  @ApiProperty({
    description: '«На проверке»: checking + checking_manually, now',
  })
  onCheck: number;

  @ApiProperty({ description: '«В ожидании»: pending, now' })
  pending: number;
}

export class MerchantDealCountersDto {
  @ApiProperty({
    type: MerchantDealTabsDto,
    description:
      'per tab, under the same period, search and filters as the list',
  })
  tabs: MerchantDealTabsDto;

  @ApiProperty({
    type: MerchantDealKpiDto,
    description:
      'the cards above the list: now, without the period or the filters',
  })
  kpi: MerchantDealKpiDto;
}
