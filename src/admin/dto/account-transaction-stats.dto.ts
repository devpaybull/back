import { ApiProperty } from '@nestjs/swagger';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';

export class CompletedLast24hDto {
  @ApiProperty()
  count: number;

  @ApiProperty({ type: String, example: '90500.000000' })
  amount: string;
}

export class StatusCountsDto {
  @ApiProperty()
  pending: number;

  @ApiProperty()
  processing: number;

  @ApiProperty()
  completed: number;

  @ApiProperty()
  failed: number;

  @ApiProperty()
  canceled: number;
}

export class DepositStatsDto {
  @ApiProperty({ description: 'Every deposit row' })
  total: number;

  @ApiProperty({ description: 'pending + processing right now' })
  inProgress: number;

  @ApiProperty({
    description:
      'processing right now (found, or accumulating below the minimum)',
  })
  processing: number;

  @ApiProperty({
    description: 'processing because the received sum is below the minimum',
  })
  belowMinimum: number;

  @ApiProperty({ description: 'failed right now — needs an admin' })
  problem: number;

  @ApiProperty({ type: CompletedLast24hDto })
  completedLast24h: CompletedLast24hDto;

  @ApiProperty({
    description: 'completed ÷ every row finished in the last 24 h, percent',
  })
  successRate: number;

  @ApiProperty({ type: StatusCountsDto })
  byStatus: Record<AccountTransactionStatus, number>;
}

export class WithdrawalStatsDto {
  @ApiProperty({ description: 'pending right now' })
  queued: number;

  @ApiProperty({ description: 'processing right now — being sent' })
  active: number;

  @ApiProperty({ description: 'processing longer than PAYOUT_STALE_MINUTES' })
  stale: number;

  @ApiProperty({ description: 'Always 0 until AML exists (W03)' })
  manualReview: number;

  @ApiProperty({ description: 'failed right now — needs an admin' })
  failed: number;

  @ApiProperty({ type: CompletedLast24hDto })
  paidLast24h: CompletedLast24hDto;

  @ApiProperty({
    description: 'completed ÷ every row finished in the last 24 h, percent',
  })
  successRate: number;

  @ApiProperty({ enum: ['auto', 'manual'] })
  mode: string;

  @ApiProperty({ type: StatusCountsDto })
  byStatus: Record<AccountTransactionStatus, number>;
}
