export interface MerchantChanges {
  name?: string;
  internalName?: string | null;
  groupId?: number | null;
  active?: boolean;
  exclusiveTopUp?: boolean;
  currencyIds?: number[];
  defaultCurrencyId?: number;
}
