import { ApiProperty } from '@nestjs/swagger';

export class PercentRangeDto {
  @ApiProperty({ example: 0 })
  min: number;

  @ApiProperty({ example: 14 })
  max: number;
}

export class RateSummaryDto {
  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty({ type: PercentRangeDto })
  payIn: PercentRangeDto;

  @ApiProperty({ type: PercentRangeDto })
  payOut: PercentRangeDto;
}
