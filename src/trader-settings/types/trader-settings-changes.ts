export interface TraderSettingsChanges {
  tradingEnabled?: boolean;
  payoutTradingEnabled?: boolean;
  individualRatesEnabled?: boolean;
  autoBuybackEnabled?: boolean;
  autoBuybackConcurrent?: number | null;
  payInAntifraudEnabled?: boolean;
  qrBuybackAccess?: boolean;
  userTransferAccess?: boolean;
  trustedUser?: boolean;
  insurancePayInMin?: number | null;
}

export interface TraderSettingsAudit {
  actorUserId: string;
  reason?: string | null;
}
