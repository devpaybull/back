import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { TELEGRAM_USERNAME_PATTERN } from '../../common/utils/telegram-username-pattern';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '@durov' })
  @IsOptional()
  @Matches(TELEGRAM_USERNAME_PATTERN)
  telegramUsername?: string;

  @ApiPropertyOptional({ enum: Role, example: Role.Trader })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ minLength: 8, maxLength: 128 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ enum: UserStatus, example: UserStatus.Suspended })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  resetTwoFactor?: boolean;
}
