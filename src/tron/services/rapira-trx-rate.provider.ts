import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Rate } from '../../common/types/rate';
import { toRate } from '../../common/utils/to-rate';
import { TronUnavailableError } from '../types/tron-unavailable.error';
import { TrxRateSource } from '../types/trx-rate-source';

interface RapiraRatesResponse {
  data?: { symbol: string; close: number }[];
}

@Injectable()
export class RapiraTrxRateProvider implements TrxRateSource {
  private cached: { value: Rate; fetchedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  async getUsdtPerTrx(): Promise<Rate> {
    const ttlMs = this.config.get<number>('TRX_RATE_TTL_SECONDS', 60) * 1000;

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
    const symbol = this.config.getOrThrow<string>('RAPIRA_TRX_RATE_SYMBOL');
    let body: RapiraRatesResponse;

    try {
      const response = await fetch(
        this.config.get<string>('RAPIRA_RATE_URL', ''),
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!response.ok) throw new Error(`status ${response.status}`);

      body = (await response.json()) as RapiraRatesResponse;
    } catch (error) {
      throw new TronUnavailableError(
        `TRX rate source is unavailable: ${(error as Error).message}`,
      );
    }

    const row = body.data?.find((item) => item.symbol === symbol);

    if (!row || typeof row.close !== 'number' || row.close <= 0) {
      throw new TronUnavailableError(`No TRX rate for ${symbol}`);
    }

    return toRate(String(row.close));
  }
}
