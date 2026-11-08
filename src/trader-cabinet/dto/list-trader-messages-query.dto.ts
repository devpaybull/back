import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DeviceMessageSortField } from '../../device-messages/types/device-message-sort-field.enum';
import { TraderMessageFilterDto } from './trader-message-filter.dto';

export class ListTraderMessagesQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  TraderMessageFilterDto,
) {
  @ApiPropertyOptional({
    enum: DeviceMessageSortField,
    default: DeviceMessageSortField.CreatedAt,
  })
  @IsEnum(DeviceMessageSortField)
  sortBy: DeviceMessageSortField = DeviceMessageSortField.CreatedAt;
}
