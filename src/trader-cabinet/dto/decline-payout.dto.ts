import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PayoutDeclineReason } from '../../transactions/types/payout-decline-reason.enum';

const DECLINE_COMMENT_MAX = 500;

export class DeclinePayoutDto {
  @ApiProperty({
    enum: PayoutDeclineReason,
    description:
      'recipient_bank_rejects «Банк получателя не принимает» · wrong_requisites «Неверные реквизиты» · my_card_limit «Лимит моей карты» · technical «Технические проблемы» · other «Другое», needs a comment',
  })
  @IsEnum(PayoutDeclineReason)
  reasonCode: PayoutDeclineReason;

  @ApiPropertyOptional({
    type: String,
    maxLength: DECLINE_COMMENT_MAX,
    description: 'Required with the reason other',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf(
    (dto: DeclinePayoutDto) =>
      dto.reasonCode === PayoutDeclineReason.Other || dto.comment !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(DECLINE_COMMENT_MAX)
  comment?: string;
}
