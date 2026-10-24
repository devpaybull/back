import { Device } from '../entities/device.entity';

export const deviceActivityMetadata = (
  device: Device,
): Record<string, unknown> => ({
  id: device.id,
  name: device.name,
  model: device.model ?? null,
});
