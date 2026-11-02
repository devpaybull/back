export interface CounterpartyChanges {
  enabled?: boolean;
  blacklisted?: boolean;
  autoEnableForbidden?: boolean;
  reason?: string | null;
}
