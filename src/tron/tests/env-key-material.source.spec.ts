import { TronWeb, utils } from 'tronweb';
import { EnvKeyMaterialSource } from '../services/env-key-material.source';
import { LocalTransactionSigner } from '../services/local-transaction.signer';
import { TronKeyring } from '../services/tron-keyring.service';
import { VaultKeyMaterialSource } from '../services/vault-key-material.source';
import { KeyMaterialSource } from '../types/key-material-source';
import { serializedTransaction } from './serialized-transaction.spec';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HOT_KEY = '0'.repeat(63) + '1';
const ENERGY_KEY = '0x' + '0'.repeat(63) + '2';

const PLAIN: Record<string, string> = {
  TRON_DEPOSIT_MNEMONIC: MNEMONIC,
  TRON_HOT_PRIVATE_KEY: HOT_KEY,
  TRON_ENERGY_PRIVATE_KEY: ENERGY_KEY,
};
const CIPHERTEXTS: Record<string, string> = {
  TRON_DEPOSIT_SEED_CIPHERTEXT: 'vault:v1:seed',
  TRON_HOT_KEY_CIPHERTEXT: 'vault:v1:hot',
  TRON_ENERGY_KEY_CIPHERTEXT: 'vault:v1:energy',
};
const DECRYPTED: Record<string, string> = {
  'vault:v1:seed': MNEMONIC,
  'vault:v1:hot': HOT_KEY,
  'vault:v1:energy': ENERGY_KEY,
};

const configOf = (values: Record<string, string>) => ({
  getOrThrow: jest.fn((key: string) => {
    if (!(key in values)) throw new Error(`${key} is not set`);
    return values[key];
  }),
});

const envSource = () => new EnvKeyMaterialSource(configOf(PLAIN) as never);

const vaultSource = () =>
  new VaultKeyMaterialSource(
    configOf(CIPHERTEXTS) as never,
    {
      decrypt: async (ciphertext: string) => Buffer.from(DECRYPTED[ciphertext]),
    } as never,
  );

const keyringOf = (source: KeyMaterialSource) => {
  const insert = {
    insert: () => insert,
    into: () => insert,
    values: () => insert,
    orIgnore: () => insert,
    execute: async () => undefined,
  };

  return new TronKeyring(source, {
    createQueryBuilder: () => insert,
  } as never);
};

describe('EnvKeyMaterialSource', () => {
  it.each([
    ['deposit', MNEMONIC],
    ['hot', HOT_KEY],
    ['energy', ENERGY_KEY],
  ] as const)(
    'reads the %s key from its plain variable',
    async (kind, value) => {
      expect((await envSource().read(kind)).toString('utf8')).toBe(value);
    },
  );

  it('hands out a fresh buffer every time, so zeroing one leaves the next intact', async () => {
    const source = envSource();
    const first = await source.read('hot');
    first.fill(0);

    expect((await source.read('hot')).toString('utf8')).toBe(HOT_KEY);
  });

  it('touches no Vault variable', async () => {
    const config = configOf(PLAIN);
    const source = new EnvKeyMaterialSource(config as never);

    await source.read('deposit');
    await source.read('hot');
    await source.read('energy');

    expect(config.getOrThrow.mock.calls.map(([key]) => key as string)).toEqual([
      'TRON_DEPOSIT_MNEMONIC',
      'TRON_HOT_PRIVATE_KEY',
      'TRON_ENERGY_PRIVATE_KEY',
    ]);
  });

  it('gives the same addresses as Vault with the same keys', async () => {
    const plain = keyringOf(envSource());
    const vault = keyringOf(vaultSource());

    await expect(plain.hotAddress()).resolves.toBe(await vault.hotAddress());
    await expect(plain.energyAddress()).resolves.toBe(
      await vault.energyAddress(),
    );
    await expect(plain.depositAddressAt(7)).resolves.toBe(
      await vault.depositAddressAt(7),
    );
  });

  it('gives the same signatures as Vault with the same keys', async () => {
    const transaction = serializedTransaction('TransferContract', {
      owner_address: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
      to_address: 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
      amount: 1,
    });

    for (const key of [
      { kind: 'hot' },
      { kind: 'energy' },
      { kind: 'deposit', derivationIndex: 2 },
    ] as const) {
      const plain = await new LocalTransactionSigner(envSource()).sign(
        transaction,
        key,
      );
      const vault = await new LocalTransactionSigner(vaultSource()).sign(
        transaction,
        key,
      );

      expect(plain.signature).toEqual(vault.signature);
    }

    const signed = await new LocalTransactionSigner(envSource()).sign(
      transaction,
      { kind: 'hot' },
    );
    expect(
      TronWeb.address.fromHex(
        utils.crypto
          .ecRecover(transaction.txID, signed.signature![0])
          .toString()
          .toLowerCase(),
      ),
    ).toBe(TronWeb.address.fromPrivateKey(HOT_KEY));
  });
});
