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
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { TELEGRAM_USERNAME_PATTERN } from '../../common/utils/telegram-username-pattern';

const TELEGRAM_ID_PATTERN = /^[1-9]\d{0,17}$/;

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @ValidateIf((_, value) => value !== undefined)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '@durov' })
  @ValidateIf((_, value) => value !== undefined)
  @Matches(TELEGRAM_USERNAME_PATTERN)
  telegramUsername?: string;

  @ApiPropertyOptional({ enum: Role, example: Role.Trader })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ minLength: 8, maxLength: 128 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ enum: UserStatus, example: UserStatus.Suspended })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    example: '123456789',
    nullable: true,
    description: 'Digits only. Null clears it.',
  })
  @IsOptional()
  @Matches(TELEGRAM_ID_PATTERN)
  telegramId?: string | null;

  @ApiPropertyOptional({
    example: 'traders2026 / paybull_push',
    maxLength: 255,
    nullable: true,
    description: 'Free text. Null or an empty string clears it.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(255)
  telegramGroups?: string | null;

  @ApiPropertyOptional({ example: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  resetTwoFactor?: boolean;
}
