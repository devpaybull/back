import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class AssignPayoutTraderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  traderUserId: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Reviving a canceled pay-out holds the merchant again; a balance that does not cover it needs this',
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;
}
