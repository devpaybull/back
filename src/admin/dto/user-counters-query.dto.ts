import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { UserStatus } from '../../users/types/user-status.enum';

const MAX_SEARCH_LENGTH = 100;

export class UserCountersQueryDto {
  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'the same search as the list: email, Telegram username, and the merchant name of a merchant-side account',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'only the accounts bound to this merchant (merchant, merchant support, merchant agent)',
  })
  @IsOptional()
  @IsUUID()
  merchantId?: string;
}
