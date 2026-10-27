import { MerchantGroup } from '../entities/merchant-group.entity';
import { Merchant } from '../entities/merchant.entity';

export interface MerchantGroupView {
  group: MerchantGroup;
  merchants: Merchant[];
}
