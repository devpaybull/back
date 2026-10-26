import { ApiProperty } from '@nestjs/swagger';

export class InspectedTransferDto {
  @ApiProperty()
  txHash: string;

  @ApiProperty()
  logIndex: number;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty({ type: String, example: '100.000000' })
  amount: string;

  @ApiProperty()
  blockNumber: number;

  @ApiProperty()
  blockTime: Date;
}

export class HashVerificationDto {
  @ApiProperty({
    enum: ['not_found', 'pending', 'failed', 'not_usdt', 'confirmed'],
  })
  status: string;

  @ApiProperty({ type: InspectedTransferDto, isArray: true })
  transfers: InspectedTransferDto[];

  @ApiProperty({ description: 'Whether the second button would succeed now' })
  acceptable: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The amount to this row’s address found in the transaction',
  })
  amount: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason: string | null;
}
