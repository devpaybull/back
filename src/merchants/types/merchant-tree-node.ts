import { MerchantGroup } from '../entities/merchant-group.entity';
import { Merchant } from '../entities/merchant.entity';

export type MerchantTreeNode =
  | {
      kind: 'group';
      group: MerchantGroup;
      members: Merchant[];
      shown: Merchant[];
    }
  | { kind: 'merchant'; merchant: Merchant };
