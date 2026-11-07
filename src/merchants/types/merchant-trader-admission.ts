export interface MerchantTraderAdmission {
  exclusiveTopUp: boolean;
  attachedTraderIds: ReadonlySet<string>;
  switchedOffTraderIds: ReadonlySet<string>;
}
