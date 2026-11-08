import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { INT4_MAX } from '../../common/utils/int4-max';
import { MESSAGE_TEMPLATE_PATTERN_MAX_LENGTH } from '../utils/message-template-pattern-max-length';
import { BankMessageType } from '../../message-templates/types/bank-message-type.enum';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateMessageTemplateDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  bankId: number;

  @ApiProperty({
    maxLength: 100,
    example: '900',
    description: 'The sender as the phone shows it; compared without case',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sender: string;

  @ApiProperty({ enum: BankMessageType })
  @IsEnum(BankMessageType)
  messageType: BankMessageType;

  @ApiProperty({
    maxLength: MESSAGE_TEMPLATE_PATTERN_MAX_LENGTH,
    description:
      'A JavaScript regular expression, run with the flags i and u, with a named group amount; a run is cut off after 50 ms',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_TEMPLATE_PATTERN_MAX_LENGTH)
  pattern: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
