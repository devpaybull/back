import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MESSAGE_TEXT_MAX_LENGTH } from '../../common/utils/message-text-max-length';
import { MESSAGE_TEMPLATE_PATTERN_MAX_LENGTH } from '../utils/message-template-pattern-max-length';

export class TestMessageTemplateDto {
  @ApiProperty({ maxLength: MESSAGE_TEMPLATE_PATTERN_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_TEMPLATE_PATTERN_MAX_LENGTH)
  pattern: string;

  @ApiProperty({ maxLength: MESSAGE_TEXT_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_TEXT_MAX_LENGTH)
  text: string;
}
