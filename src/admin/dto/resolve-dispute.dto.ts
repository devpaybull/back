import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';

export class AcceptDisputeDto {
  @ApiPropertyOptional({
    type: String,
    example: '1500.00',
    description:
      'Overrides the disputed amount; on a settled deal it must exceed the deal’s; a pay-out has none',
  })
  @IsOptional()
  @IsFiatAmount({ positive: true })
  amount?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Accepting a dispute on a canceled pay-out charges the merchant; a balance that does not cover it needs this, else 409 OVERDRAFT_NOT_CONFIRMED',
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;
}

export class RejectDisputeDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
