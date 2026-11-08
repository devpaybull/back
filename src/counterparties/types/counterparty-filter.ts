import { AmountRange } from './amount-range';
import { CountRange } from './count-range';
import { CounterpartyStatus } from './counterparty-status.enum';
import { VolumeWindow } from './volume-window';

export interface CounterpartyFilter {
  search?: string;
  searchMerchantIds?: readonly string[];
  searchBankDetailsIds?: readonly string[];
  merchantId?: string;
  bankDetailsIds?: readonly string[];
  status?: CounterpartyStatus;
  blacklisted?: boolean;
  autoEnableForbidden?: boolean;
  hasRequisite?: boolean;
  windowVolumes?: ReadonlyMap<VolumeWindow, AmountRange>;
  totalVolume?: AmountRange;
  paid30d?: CountRange;
  requests30d?: CountRange;
}
