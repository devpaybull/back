export interface LoginFootprintRecord {
  id: number;
  ip: string;
  country: string | null;
  fingerprint: string | null;
  userAgent: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  seenOnAccounts: number;
}
