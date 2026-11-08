import { SortOrder } from '../../common/enums/sort-order.enum';
import { DeviceMessageFilter } from './device-message-filter';
import { DeviceMessageSortField } from './device-message-sort-field.enum';

export interface DeviceMessageListQuery extends DeviceMessageFilter {
  page: number;
  limit: number;
  sortBy: DeviceMessageSortField;
  sortOrder: SortOrder;
}
