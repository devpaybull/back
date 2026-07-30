import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, Matches } from 'class-validator';
import { TELEGRAM_USERNAME_PATTERN } from '../../common/utils/telegram-username-pattern';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '@durov' })
  @IsOptional()
  @Matches(TELEGRAM_USERNAME_PATTERN)
  telegramUsername?: string;
}
