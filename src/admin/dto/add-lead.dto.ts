import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsUUID, Min } from 'class-validator';

export class AddLeadDto {
  @ApiProperty({ format: 'uuid', description: 'A lead_trader account' })
  @IsUUID()
  leadUserId: string;

  @ApiProperty({ description: 'The id of a row in currencies' })
  @IsInt()
  @Min(1)
  currencyId: number;

  @ApiProperty({
    description:
      'The lead’s general pay-in rate from this trader in this currency',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payInPercent: number;

  @ApiProperty({
    description:
      'The lead’s general pay-out rate from this trader in this currency',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payOutPercent: number;
}
