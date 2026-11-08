import { Crypto } from '../../common/types/crypto';
import { NotificationLimitType } from './notification-limit-type.enum';
import { NotificationType } from './notification-type.enum';

export interface NotificationSettingChange {
  type: NotificationType;
  enabled: boolean;
  threshold?: Crypto;
  method?: string;
  limitType?: NotificationLimitType;
}
