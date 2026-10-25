import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinDate,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { TELEGRAM_USERNAME_PATTERN } from '../../common/utils/telegram-username-pattern';

export class CreateInviteDto {
  @ApiProperty({ enum: Role, example: Role.Trader })
  @IsEnum(Role)
  role: Role;

  @ApiProperty({ example: '@durov' })
  @IsString()
  @Matches(TELEGRAM_USERNAME_PATTERN)
  telegramUsername: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'When the code stops working; defaults to INVITE_TTL_HOURS from now',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), {
    message: '$property must be a moment in the future',
  })
  expiresAt?: Date;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The merchant the invited account works for; required for merchant_support and merchant_agent, refused for every other role',
  })
  @IsOptional()
  @IsUUID()
  merchantId?: string;
}
