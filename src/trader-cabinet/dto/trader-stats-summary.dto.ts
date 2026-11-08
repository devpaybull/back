import { ApiProperty } from '@nestjs/swagger';

export class TraderStatsIssueDto {
  @ApiProperty({ description: 'Selection gave the trader’s requisite a deal' })
  issued: number;

  @ApiProperty({
    description:
      'Selection chose the trader’s requisite and it fell away under the lock',
  })
  skipped: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 95,
    description: 'issued / (issued + skipped), two decimals; null with neither',
  })
  percent: number | null;
}

export class TraderStatsPaymentDto {
  @ApiProperty({ description: 'success and success_changed' })
  paid: number;

  @ApiProperty()
  canceled: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 52,
    description: 'paid / (paid + canceled), two decimals; null with neither',
  })
  percent: number | null;
}

export class TraderStatsTurnoverDto {
  @ApiProperty({
    type: String,
    example: '520000.00',
    description: 'Σ amountFiat of successful deals',
  })
  amount: string;

  @ApiProperty({ description: 'How many successful deals' })
  count: number;

  @ApiProperty({ type: String, nullable: true, example: '1550.05' })
  averageCheck: string | null;
}

export class TraderStatsIncomeDto {
  @ApiProperty({
    type: String,
    example: '500.000000',
    description: 'Σ traderCommission of successful deals, USDT',
  })
  amount: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '88.930000',
    description: 'Σ amountFiat / Σ amountCrypto of the same deals',
  })
  averageRate: string | null;
}

export class TraderStatsResponseDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Seconds, average resolvedAt − createdAt of successful pay-ins resolved in the period',
  })
  depositSeconds: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Seconds, average from the take to the receipt of pay-outs completed in the period',
  })
  payoutSeconds: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Seconds, average from opening to the decision of disputes decided in the period',
  })
  disputeSeconds: number | null;
}

export class TraderStatsSummaryDto {
  @ApiProperty({ type: TraderStatsIssueDto, description: '«Конверсия выдачи»' })
  issue: TraderStatsIssueDto;

  @ApiProperty({
    type: TraderStatsPaymentDto,
    description: '«Конверсия в оплату», by the deals created in the period',
  })
  payment: TraderStatsPaymentDto;

  @ApiProperty({
    type: TraderStatsTurnoverDto,
    description: '«Оборот», by the deals resolved in the period',
  })
  turnover: TraderStatsTurnoverDto;

  @ApiProperty({ type: TraderStatsIncomeDto, description: '«Доход»' })
  income: TraderStatsIncomeDto;

  @ApiProperty({ type: TraderStatsResponseDto, description: '«Реагирование»' })
  response: TraderStatsResponseDto;
}
