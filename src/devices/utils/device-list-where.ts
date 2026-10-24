import { FindOptionsWhere, ILike } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { Device } from '../entities/device.entity';
import { DeviceListQuery } from '../types/device-list-query';

export const deviceListWhere = (
  query: DeviceListQuery,
): FindOptionsWhere<Device> => ({
  ...(query.userId !== undefined ? { userId: query.userId } : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.search
    ? { name: ILike(`%${escapeLikePattern(query.search)}%`) }
    : {}),
});
