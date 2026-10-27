import { MerchantSettings } from '../entities/merchant-settings.entity';

export type MerchantSettingsView = Omit<
  MerchantSettings,
  'id' | 'merchant' | 'defaultCurrency' | 'createdAt' | 'updatedAt'
>;
