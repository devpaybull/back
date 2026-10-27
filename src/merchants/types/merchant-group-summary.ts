import { MerchantGroup } from '../entities/merchant-group.entity';

export interface MerchantGroupSummary {
  group: MerchantGroup;
  merchantCount: number;
}
