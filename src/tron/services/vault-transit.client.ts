import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TronUnavailableError } from '../types/tron-unavailable.error';
import { VAULT_AUTH, VaultAuth, VaultToken } from '../types/vault-auth';

const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_RENEW_MARGIN_MS = 60_000;

@Injectable()
export class VaultTransitClient {
  private token: VaultToken | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(VAULT_AUTH) private readonly auth: VaultAuth,
  ) {}

  async decrypt(ciphertext: string): Promise<Buffer> {
    const key = this.config.getOrThrow<string>('VAULT_TRANSIT_KEY');
    const address = this.config
      .getOrThrow<string>('VAULT_ADDR')
      .replace(/\/$/, '');
    const token = await this.currentToken();
    let response: Response;

    try {
      response = await fetch(
        `${address}/v1/transit/decrypt/${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Vault-Token': token,
          },
          body: JSON.stringify({ ciphertext }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw new TronUnavailableError(
        `Vault unreachable: ${(error as Error).message}`,
      );
    }

    if (response.status === 403) this.token = null;

    if (!response.ok) {
      throw new TronUnavailableError(
        `Vault decrypt answered ${response.status}`,
      );
    }

    const body = (await response.json()) as { data?: { plaintext?: string } };

    if (!body.data?.plaintext) {
      throw new TronUnavailableError('Vault decrypt returned no plaintext');
    }

    return Buffer.from(body.data.plaintext, 'base64');
  }

  private async currentToken(): Promise<string> {
    if (
      !this.token ||
      this.token.expiresAt - TOKEN_RENEW_MARGIN_MS <= Date.now()
    ) {
      this.token = await this.auth.login();
    }

    return this.token.token;
  }
}
