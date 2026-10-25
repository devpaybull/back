import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DeviceSortField } from '../../devices/types/device-sort-field';
import { DeviceStatus } from '../../devices/types/device-status.enum';

export class ListDevicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

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
