import { SortOrder } from '../../common/enums/sort-order.enum';
import { DeviceSortField } from './device-sort-field';
import { DeviceStatus } from './device-status.enum';

export interface DeviceListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: DeviceSortField;
  sortOrder: SortOrder;
  userId?: string;
  status?: DeviceStatus;
}
