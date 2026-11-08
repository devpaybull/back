import { Crypto } from '../../common/types/crypto';
import { NotificationLimitType } from './notification-limit-type.enum';
import { NotificationType } from './notification-type.enum';

export interface NotificationSettingState {
  type: NotificationType;
  enabled: boolean;
  alwaysOn: boolean;
  threshold: Crypto | null;
  method: string | null;
  limitType: NotificationLimitType | null;
}
