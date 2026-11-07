import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Device } from '../entities/device.entity';
import { DeviceRequest } from '../types/device-request';

export const CurrentDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Device =>
    context.switchToHttp().getRequest<DeviceRequest>().device as Device,
);
