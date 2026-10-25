import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Rate } from '../../common/types/rate';
import { toRate } from '../../common/utils/to-rate';

interface RapiraRate {
  symbol: string;
  close: number;
}

interface RapiraRatesResponse {
  data?: RapiraRate[];
}

@Injectable()
export class RapiraRateProvider {
  private cached: { value: Rate; fetchedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  async getFiatPerUsdt(): Promise<Rate> {
    const ttlMs = this.config.get<number>('RAPIRA_RATE_TTL_SECONDS', 0) * 1000;
    if (this.cached && Date.now() - this.cached.fetchedAt < ttlMs) {
      return this.cached.value;
    }

    try {
      const value = await this.fetchRate();
      this.cached = { value, fetchedAt: Date.now() };
      return value;
    } catch (error) {
      if (this.cached) return this.cached.value;
      throw error;
    }
  }

  private async fetchRate(): Promise<Rate> {
    const url = this.config.get<string>('RAPIRA_RATE_URL', '');
    const symbol = this.config.get<string>('RAPIRA_RATE_SYMBOL', '');

    let body: RapiraRatesResponse;
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Rapira responded with status ${response.status}`);
      }
      body = (await response.json()) as RapiraRatesResponse;
    } catch {
      throw new ServiceUnavailableException(
        'Exchange rate source is unavailable',
      );
    }

    const row = body.data?.find((item) => item.symbol === symbol);
    if (!row || typeof row.close !== 'number') {
      throw new ServiceUnavailableException(
        'Exchange rate is unavailable for the configured pair',
      );
    }

    return toRate(String(row.close));
  }
}
