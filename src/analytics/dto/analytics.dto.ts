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
}

export class VolumeAnalyticsSummaryDto {
  @ApiProperty()
  cryptoSent: number;

  @ApiProperty()
  cryptoReceived: number;

  @ApiProperty()
  fiatSent: number;

  @ApiProperty()
  fiatReceived: number;

  @ApiProperty()
  profit: number;
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
