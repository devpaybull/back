import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CountryResponse, open, Reader } from 'maxmind';
import { isPublicIp } from '../utils/is-public-ip';
import { normalizeIp } from '../utils/normalize-ip';

@Injectable()
export class GeoIpService implements OnModuleInit {
  private readonly logger = new Logger(GeoIpService.name);
  private reader: Reader<CountryResponse> | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const path = this.config.get<string>('GEOIP_DB_PATH');

    if (!path) return;

    try {
      this.reader = await open<CountryResponse>(path);
    } catch (error) {
      this.logger.warn(
        `GeoIP database ${path} could not be opened, countries will be empty: ${String(error)}`,
      );
    }
  }

  countryOf(ip: string): string | null {
    if (!this.reader) return null;

    const address = normalizeIp(ip);

    if (!isPublicIp(address)) return null;

    try {
      return this.reader.get(address)?.country?.iso_code ?? null;
    } catch (error) {
      this.logger.warn(`GeoIP lookup failed for ${address}: ${String(error)}`);

      return null;
    }
  }
}
