import { ApiProperty } from '@nestjs/swagger';

export class DashboardRateDto {
  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty({
    type: String,
    example: '88.240000',
    description:
      'Rapira + 1% with the merchant’s pay-in markup of the currency',
  })
  value: string;
}

export class DashboardBalanceDto {
  @ApiProperty({ type: String })
  available: string;

  @ApiProperty({ type: String })
  escrow: string;

  @ApiProperty({
    type: DashboardRateDto,
    nullable: true,
    description:
      'null when the default currency is not RUB or Rapira is unavailable',
  })
  rate: DashboardRateDto | null;
}

export class DashboardWithdrawalsDto {
  @ApiProperty({
    type: String,
    description: '«Текущие выводы»: requests not paid and not canceled yet',
  })
  inProgressAmount: string;

  @ApiProperty({ description: '«Заявок к получению»' })
  inProgressCount: number;
}

export class DashboardPeriodDto {
  @ApiProperty({ type: Date, nullable: true, description: 'null for all time' })
  from: Date | null;

  @ApiProperty()
  to: Date;
}

export class DashboardResultsDto {
  @ApiProperty({
    type: String,
    description:
      'successful pay-ins and pay-outs, amountCrypto, before commission',
  })
  turnover: string;

  @ApiProperty({
    type: String,
    description: 'successful pay-ins, merchantAmount, after commission',
  })
  creditedPayIn: string;

  @ApiProperty({
    type: String,
    description: 'successful pay-ins, merchantCommission',
  })
  payInCommission: string;

  @ApiProperty({
    type: String,
    description: 'paid withdrawal requests, by completedAt',
  })
  withdrawn: string;
}

export class DashboardPayInsDto {
  @ApiProperty()
  successfulCount: number;

  @ApiProperty({ type: String })
  successfulAmount: string;

  @ApiProperty({ type: String, description: '"0.000000" with none' })
  averageAmount: string;
}

export class MerchantDashboardDto {
  @ApiProperty({ type: DashboardBalanceDto })
  balance: DashboardBalanceDto;

  @ApiProperty({ type: DashboardWithdrawalsDto })
  withdrawals: DashboardWithdrawalsDto;

  @ApiProperty({ type: DashboardPeriodDto })
  period: DashboardPeriodDto;

  @ApiProperty({ type: DashboardResultsDto })
  results: DashboardResultsDto;

  @ApiProperty({ type: DashboardPayInsDto })
  payIns: DashboardPayInsDto;
}

export class TurnoverPointDto {
  @ApiProperty({ example: '2026-08-19' })
  day: string;

  @ApiProperty({ type: String, example: '4521.520000' })
  amount: string;
}
