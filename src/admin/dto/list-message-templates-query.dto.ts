import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { INT4_MAX } from '../../common/utils/int4-max';
import { BankMessageType } from '../../message-templates/types/bank-message-type.enum';
import { MessageTemplateSortField } from '../../message-templates/types/message-template-sort-field.enum';

const asBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

export class ListMessageTemplatesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  bankId?: number;

  @ApiPropertyOptional({ enum: BankMessageType })
  @IsOptional()
  @IsEnum(BankMessageType)
  messageType?: BankMessageType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    enum: MessageTemplateSortField,
    default: MessageTemplateSortField.CreatedAt,
  })
  @IsEnum(MessageTemplateSortField)
  sortBy: MessageTemplateSortField = MessageTemplateSortField.CreatedAt;
}
