import { Device } from '../../src/devices/entities/device.entity';
import { E2eContext, E2eUser } from './e2e-app';

export const deviceOf = async (
  e2e: E2eContext,
  owner: E2eUser,
): Promise<number> =>
  (
    await e2e.dataSource
      .getRepository(Device)
      .save({ userId: owner.user.id, name: 'Pixel 7' })
  ).id;
