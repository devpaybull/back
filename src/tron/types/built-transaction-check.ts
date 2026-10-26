export interface BuiltTransactionCheck {
  type: string;
  value: Record<string, unknown>;
  feeLimitSun?: string;
}
