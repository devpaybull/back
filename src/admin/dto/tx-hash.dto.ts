import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { TX_HASH_PATTERN } from '../../tron/utils/tx-hash-pattern';

export class TxHashDto {
  @ApiProperty({ example: 'a'.repeat(64), description: '64 hex characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(TX_HASH_PATTERN, { message: 'txHash must be 64 hex characters' })
  txHash: string;
}
