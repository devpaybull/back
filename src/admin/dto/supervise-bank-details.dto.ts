import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class SuperviseBankDetailsDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Bans the bank details; the owner cannot lift a ban',
  })
  @IsOptional()
  @IsBoolean()
  banned?: boolean;
}
