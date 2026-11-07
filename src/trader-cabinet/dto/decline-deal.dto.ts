import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PayInDeclineReason } from '../../transactions/types/pay-in-decline-reason.enum';

const DECLINE_COMMENT_MAX = 500;

export class DeclineDealDto {
  @ApiProperty({
    enum: PayInDeclineReason,
    description:
      'requisite_blocked «Реквизит заблокирован банком» also switches the requisite off · limit_reached «Лимит карты исчерпан» · device_offline «Нет доступа к устройству» · other «Другое», needs a comment',
  })
  @IsEnum(PayInDeclineReason)
  reasonCode: PayInDeclineReason;

  @ApiPropertyOptional({
    type: String,
    maxLength: DECLINE_COMMENT_MAX,
    description: 'Required with the reason other',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf(
    (dto: DeclineDealDto) =>
      dto.reasonCode === PayInDeclineReason.Other || dto.comment !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(DECLINE_COMMENT_MAX)
  comment?: string;
}
