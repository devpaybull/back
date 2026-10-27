import { ConfigService } from '@nestjs/config';
import { KeyKind } from '../types/key-kind';
import { KeyMaterialSource } from '../types/key-material-source';
import { VaultTransitClient } from './vault-transit.client';

const CIPHERTEXT_VARIABLES: Record<KeyKind, string> = {
  deposit: 'TRON_DEPOSIT_SEED_CIPHERTEXT',
  hot: 'TRON_HOT_KEY_CIPHERTEXT',
  energy: 'TRON_ENERGY_KEY_CIPHERTEXT',
};

export class VaultKeyMaterialSource implements KeyMaterialSource {
  constructor(
    private readonly config: ConfigService,
    private readonly vault: VaultTransitClient,
  ) {}

  read(kind: KeyKind): Promise<Buffer> {
    return this.vault.decrypt(
      this.config.getOrThrow<string>(CIPHERTEXT_VARIABLES[kind]),
    );
  }
}
