import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DeviceMessageSortField } from '../../device-messages/types/device-message-sort-field.enum';
import { DeviceMessageFilterDto } from './device-message-filter.dto';

export class ListDeviceMessagesQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  DeviceMessageFilterDto,
) {
  @ApiPropertyOptional({
    enum: DeviceMessageSortField,
    default: DeviceMessageSortField.CreatedAt,
    description: 'sender is the raw sender, alphabetical',
  })
  @IsEnum(DeviceMessageSortField)
  sortBy: DeviceMessageSortField = DeviceMessageSortField.CreatedAt;
}
