import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsOptional,
  Matches,
  MinDate,
  ValidateIf,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { TELEGRAM_USERNAME_PATTERN } from '../../common/utils/telegram-username-pattern';

export class CreateInviteDto {
  @ApiProperty({ enum: Role, example: Role.Trader })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @ValidateIf((dto: CreateInviteDto) => !dto.telegramUsername)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '@durov' })
  @IsOptional()
  @ValidateIf((dto: CreateInviteDto) => !dto.email)
  @Matches(TELEGRAM_USERNAME_PATTERN)
  telegramUsername?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'When the code stops working; defaults to INVITE_TTL_HOURS from now',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date())
  expiresAt?: Date;
}
