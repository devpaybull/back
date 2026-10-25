import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';

export class AdminTransferDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(320)
  recipient: string;

  @ApiProperty({
    type: String,
    example: '100.000000',
    description: 'USDT, a decimal string with at most 6 decimals',
  })
  @IsCryptoAmount({ positive: true })
  amount: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
