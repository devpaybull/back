import { FindOptionsOrder } from 'typeorm';
import { sortDirection } from '../../common/utils/sort-direction';
import { Device } from '../entities/device.entity';
import { DeviceListQuery } from '../types/device-list-query';
import { DeviceSortField } from '../types/device-sort-field';

export const deviceListOrder = (
  query: DeviceListQuery,
): FindOptionsOrder<Device> => {
  const direction = sortDirection(query.sortOrder);

  switch (query.sortBy) {
    case DeviceSortField.Id:
      return { id: direction };
    case DeviceSortField.CreatedAt:
      return { createdAt: direction, id: direction };
    case DeviceSortField.Name:
      return { name: direction, id: direction };
    case DeviceSortField.LastActivity:
      return { lastActivity: direction, id: direction };
  }
};
