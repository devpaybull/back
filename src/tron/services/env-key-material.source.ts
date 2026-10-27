import { ConfigService } from '@nestjs/config';
import { KeyKind } from '../types/key-kind';
import { KeyMaterialSource } from '../types/key-material-source';

const PLAINTEXT_VARIABLES: Record<KeyKind, string> = {
  deposit: 'TRON_DEPOSIT_MNEMONIC',
  hot: 'TRON_HOT_PRIVATE_KEY',
  energy: 'TRON_ENERGY_PRIVATE_KEY',
};

export class EnvKeyMaterialSource implements KeyMaterialSource {
  constructor(private readonly config: ConfigService) {}

  read(kind: KeyKind): Promise<Buffer> {
    return Promise.resolve(
      Buffer.from(
        this.config.getOrThrow<string>(PLAINTEXT_VARIABLES[kind]),
        'utf8',
      ),
    );
  }
}
