import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { utils } from 'tronweb';
import { SigningKeyRef } from '../types/signing-key-ref';
import { TransactionSigner } from '../types/transaction-signer';
import { TronTransaction } from '../types/tron-transaction';
import { DEPOSIT_ACCOUNT_PATH } from '../utils/deposit-account-path';
import { VaultTransitClient } from './vault-transit.client';

@Injectable()
export class VaultTransactionSigner implements TransactionSigner {
  constructor(
    private readonly config: ConfigService,
    private readonly vault: VaultTransitClient,
  ) {}

  async sign(
    transaction: TronTransaction,
    key: SigningKeyRef,
  ): Promise<TronTransaction> {
    const expectedId = createHash('sha256')
      .update(Buffer.from(transaction.raw_data_hex, 'hex'))
      .digest('hex');

    if (
      expectedId !== transaction.txID ||
      !utils.transaction.txCheck(transaction as never)
    ) {
      throw new Error('The transaction id does not match its raw data');
    }

    const privateKey = await this.privateKeyOf(key);

    try {
      return utils.crypto.signTransaction(
        privateKey.toString('utf8'),
        transaction as never,
      ) as unknown as TronTransaction;
    } finally {
      privateKey.fill(0);
    }
  }

  private async privateKeyOf(key: SigningKeyRef): Promise<Buffer> {
    if (key.kind !== 'deposit') {
      const plaintext = await this.vault.decrypt(
        this.config.getOrThrow<string>(
          key.kind === 'hot'
            ? 'TRON_HOT_KEY_CIPHERTEXT'
            : 'TRON_ENERGY_KEY_CIPHERTEXT',
        ),
      );
      const normalized = Buffer.from(
        plaintext.toString('utf8').trim().replace(/^0x/, ''),
        'utf8',
      );
      plaintext.fill(0);

      return normalized;
    }

    const seed = await this.vault.decrypt(
      this.config.getOrThrow<string>('TRON_DEPOSIT_SEED_CIPHERTEXT'),
    );

    try {
      const wallet = utils.ethersUtils.ethersHDNodeWallet.fromPhrase(
        seed.toString('utf8').trim(),
        undefined,
        `${DEPOSIT_ACCOUNT_PATH}/0/${key.derivationIndex}`,
      );

      return Buffer.from(wallet.privateKey.replace(/^0x/, ''), 'utf8');
    } finally {
      seed.fill(0);
    }
  }
}
