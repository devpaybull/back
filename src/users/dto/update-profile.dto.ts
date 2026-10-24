import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, Matches, ValidateIf } from 'class-validator';
import { TELEGRAM_USERNAME_PATTERN } from '../../common/utils/telegram-username-pattern';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @ValidateIf((_, value) => value !== undefined)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '@durov' })
  @ValidateIf((_, value) => value !== undefined)
  @Matches(TELEGRAM_USERNAME_PATTERN)
  telegramUsername?: string;
}
