import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TronUnavailableError } from '../types/tron-unavailable.error';
import { VaultAuth, VaultToken } from '../types/vault-auth';

const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class AppRoleVaultAuth implements VaultAuth {
  constructor(private readonly config: ConfigService) {}

  async login(): Promise<VaultToken> {
    const address = this.config
      .getOrThrow<string>('VAULT_ADDR')
      .replace(/\/$/, '');
    let response: Response;

    try {
      response = await fetch(`${address}/v1/auth/approle/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role_id: this.config.getOrThrow<string>('VAULT_ROLE_ID'),
          secret_id: this.config.getOrThrow<string>('VAULT_SECRET_ID'),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TronUnavailableError(
        `Vault unreachable: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new TronUnavailableError(`Vault login answered ${response.status}`);
    }

    const body = (await response.json()) as {
      auth?: { client_token?: string; lease_duration?: number };
    };

    if (!body.auth?.client_token) {
      throw new TronUnavailableError('Vault login returned no token');
    }

    return {
      token: body.auth.client_token,
      expiresAt: Date.now() + (body.auth.lease_duration ?? 0) * 1000,
    };
  }
}
