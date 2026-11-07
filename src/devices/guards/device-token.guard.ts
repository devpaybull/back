import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DevicesService } from '../devices.service';
import { DeviceRequest } from '../types/device-request';

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly devices: DevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith(BEARER_PREFIX)
      ? header.slice(BEARER_PREFIX.length).trim()
      : '';
    const device = token ? await this.devices.authenticate(token) : null;

    if (!device) {
      throw new UnauthorizedException('Device token is invalid or revoked');
    }

    request.device = device;

    return true;
  }
}
