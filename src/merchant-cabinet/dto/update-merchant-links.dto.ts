import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUrl, MaxLength } from 'class-validator';

const URL_OPTIONS = { protocols: ['https'], require_protocol: true };
const URL_MAX = 2048;

export class UpdateMerchantLinksDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: URL_MAX,
    description: 'https only; null clears',
  })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  supportLink?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  callbackUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  successUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  errorUrl?: string | null;
}
