import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, MinDate } from 'class-validator';

export class ExtendInviteDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'The new moment the code stops working; must be in the future',
  })
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), {
    message: '$property must be a moment in the future',
  })
  expiresAt: Date;
}
