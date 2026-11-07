export interface TraderMerchantExclusions {
  exclusiveMerchantIds: string[];
  attachedMerchantIds(method: string): string[];
  switchedOffMerchantIds(method: string): string[];
}
