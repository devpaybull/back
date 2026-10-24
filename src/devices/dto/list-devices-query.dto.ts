import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DeviceSortField } from '../types/device-sort-field';
import { DeviceStatus } from '../types/device-status.enum';

export class ListDevicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DeviceStatus })
  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @ApiPropertyOptional({
    enum: DeviceSortField,
    default: DeviceSortField.CreatedAt,
  })
  @IsEnum(DeviceSortField)
  sortBy: DeviceSortField = DeviceSortField.CreatedAt;
}
