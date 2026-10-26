export interface VaultToken {
  token: string;
  expiresAt: number;
}

export interface VaultAuth {
  login(): Promise<VaultToken>;
}

export const VAULT_AUTH = Symbol('VAULT_AUTH');
