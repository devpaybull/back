import { ApiProperty } from '@nestjs/swagger';

export class PayInAnalyticsPointDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  conversionPercent: number;

  @ApiProperty()
  disputePercent: number;
}

export class PayInAnalyticsDto {
  @ApiProperty()
  averageConversionPercent: number;

  @ApiProperty()
  disputePercent: number;

  @ApiProperty({ type: [PayInAnalyticsPointDto] })
  series: PayInAnalyticsPointDto[];
}

export class DealsAnalyticsPointDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  total: number;

  @ApiProperty()
  success: number;

  @ApiProperty()
  fail: number;

  @ApiProperty()
  dispute: number;
}

export class DealsAnalyticsDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  success: number;

  @ApiProperty()
  fail: number;

  @ApiProperty()
  dispute: number;

  @ApiProperty({ type: [DealsAnalyticsPointDto] })
  series: DealsAnalyticsPointDto[];
}

export class VolumeAnalyticsPointDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  payInCount: number;

  @ApiProperty()
  payOutCount: number;

  @ApiProperty({
    type: String,
    example: '100.000000',
    description:
      'Sum of amountCrypto (USDT) of successful (success, success_changed) pay-in deals created that day; 0 for an empty day',
  })
  payInAmount: string;

  @ApiProperty({
    type: String,
    example: '100.000000',
    description:
      'Sum of amountCrypto (USDT) of successful (success, success_changed) pay-out deals created that day; 0 for an empty day',
  })
  payOutAmount: string;
}

export class VolumeAnalyticsSummaryDto {
  @ApiProperty({ type: String, example: '100.000000' })
  cryptoSent: string;

  @ApiProperty({ type: String, example: '100.000000' })
  cryptoReceived: string;

  @ApiProperty({ type: String, example: '1000.00' })
  fiatSent: string;

  @ApiProperty({ type: String, example: '1000.00' })
  fiatReceived: string;

  @ApiProperty({ type: String, example: '100.000000' })
  profit: string;
}

export class VolumeAnalyticsDto {
  @ApiProperty()
  payInCount: number;

  @ApiProperty()
  payOutCount: number;

  @ApiProperty({ type: [VolumeAnalyticsPointDto] })
  series: VolumeAnalyticsPointDto[];

  @ApiProperty({ type: VolumeAnalyticsSummaryDto })
  summary: VolumeAnalyticsSummaryDto;
}
