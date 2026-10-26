import { Rate } from '../../common/types/rate';

export interface TrxRateSource {
  getUsdtPerTrx(): Promise<Rate>;
}

export const TRX_RATE_SOURCE = Symbol('TRX_RATE_SOURCE');
