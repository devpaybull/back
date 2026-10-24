import { ApiProperty } from '@nestjs/swagger';

export class ReferralRateSummaryDto {
  @ApiProperty()
  currencyId: number;

  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty()
  payInMin: number;

  @ApiProperty()
  payInMax: number;

  @ApiProperty()
  payOutMin: number;

  @ApiProperty()
  payOutMax: number;
}

export class ReferralDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The other side of the link: a trader on a lead’s page, a lead on a trader’s page',
  })
  id: string;

  @ApiProperty()
  login: string;

  @ApiProperty({
    type: [ReferralRateSummaryDto],
    description:
      'The lead’s rate from this trader, per currency: min–max over the currency general rate and every detail row',
  })
  rates: ReferralRateSummaryDto[];
}
