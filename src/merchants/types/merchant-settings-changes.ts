import { Crypto } from '../../common/types/crypto';
import { Fiat } from '../../common/types/fiat';
import { MerchantRateCalculation } from './merchant-rate-calculation.enum';
import { MerchantRateSource } from './merchant-rate-source.enum';

export interface MerchantSettingsChanges {
  minPayInAmount?: Fiat | null;
  payInWindowMinutes?: number | null;
  randomizationWindow?: number;
  sameRequestsEnabled?: boolean;
  telegramAlertEnabled?: boolean;
  failedDealsLimitEnabled?: boolean;
  failedDealsPerHour?: number;
  payoutOverdraftEnabled?: boolean;
  autoPayoutEnabled?: boolean;
  autoPayoutAddress?: string | null;
  autoPayoutAmount?: Crypto | null;
  withdrawalFee?: Crypto;
  withdrawalFeeWaived?: boolean;
  rateSource?: MerchantRateSource;
  rateCalculation?: MerchantRateCalculation;
  callbackUrl?: string | null;
  successUrl?: string | null;
  errorUrl?: string | null;
  supportLink?: string | null;
  ipCheckEnabled?: boolean;
}
