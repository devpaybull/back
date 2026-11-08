import { NotificationLimitType } from './notification-limit-type.enum';

export interface NotificationParams {
  threshold?: string | null;
  method?: string;
  limitType?: NotificationLimitType;
}
