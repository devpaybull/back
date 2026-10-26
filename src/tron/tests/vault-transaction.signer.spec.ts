import { TronWeb, utils } from 'tronweb';
import { VaultTransactionSigner } from '../services/vault-transaction.signer';
import { TronTransaction } from '../types/tron-transaction';
import { serializedTransaction } from './serialized-transaction.spec';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HOT_KEY = '0'.repeat(63) + '1';
const ENERGY_KEY = '0x' + '0'.repeat(63) + '2';
const CIPHERTEXTS: Record<string, string> = {
  TRON_DEPOSIT_SEED_CIPHERTEXT: 'vault:v1:seed',
  TRON_HOT_KEY_CIPHERTEXT: 'vault:v1:hot',
  TRON_ENERGY_KEY_CIPHERTEXT: 'vault:v1:energy',
};
const PLAINTEXTS: Record<string, string> = {
  'vault:v1:seed': MNEMONIC,
  'vault:v1:hot': `${HOT_KEY}\n`,
  'vault:v1:energy': ENERGY_KEY,
};

const transaction = (): TronTransaction =>
  serializedTransaction('TransferContract', {
    owner_address: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
    to_address: 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
    amount: 1,
  });

const signerOf = (txID: string, signature: string): string =>
  TronWeb.address.fromHex(
    utils.crypto.ecRecover(txID, signature).toString().toLowerCase(),
  );

const build = () => {
  const decrypted: Buffer[] = [];
  const vault = {
    decrypt: jest.fn(async (ciphertext: string) => {
      const buffer = Buffer.from(PLAINTEXTS[ciphertext]);
      decrypted.push(buffer);
      return buffer;
    }),
  };
  const config = { getOrThrow: jest.fn((key: string) => CIPHERTEXTS[key]) };

  return {
    signer: new VaultTransactionSigner(config as never, vault as never),
    vault,
    decrypted,
  };
};

describe('VaultTransactionSigner', () => {
  it('refuses a transaction whose id is not the hash of its raw data', async () => {
    const { signer, vault } = build();

    await expect(
      signer.sign({ ...transaction(), txID: 'ff'.repeat(32) }, { kind: 'hot' }),
    ).rejects.toThrow(/does not match/);
    expect(vault.decrypt).not.toHaveBeenCalled();
  });

  it('refuses a raw_data that does not encode to its raw_data_hex', async () => {
    const { signer, vault } = build();
    const honest = transaction();
    const forged = {
      ...honest,
      raw_data: { ...honest.raw_data, fee_limit: 1 },
    };

    await expect(signer.sign(forged, { kind: 'hot' })).rejects.toThrow(
      /does not match/,
    );
    expect(vault.decrypt).not.toHaveBeenCalled();
  });

  it('signs with the hot key so the signature recovers the hot address', async () => {
    const { signer, vault } = build();
    const unsigned = transaction();

    const signed = await signer.sign(unsigned, { kind: 'hot' });

    expect(vault.decrypt).toHaveBeenCalledWith('vault:v1:hot');
    expect(signed.signature).toHaveLength(1);
    expect(signerOf(unsigned.txID, signed.signature![0])).toBe(
      TronWeb.address.fromPrivateKey(HOT_KEY),
    );
  });

  it('signs with the energy key from its own ciphertext', async () => {
    const { signer, vault } = build();
    const unsigned = transaction();

    const signed = await signer.sign(unsigned, { kind: 'energy' });

    expect(vault.decrypt).toHaveBeenCalledWith('vault:v1:energy');
    expect(signerOf(unsigned.txID, signed.signature![0])).toBe(
      TronWeb.address.fromPrivateKey(ENERGY_KEY.slice(2)),
    );
  });

  it('signs a deposit address with the key derived from the seed at its index', async () => {
    const { signer, vault } = build();
    const unsigned = transaction();

    const signed = await signer.sign(unsigned, {
      kind: 'deposit',
      derivationIndex: 1,
    });

    expect(vault.decrypt).toHaveBeenCalledWith('vault:v1:seed');
    expect(signerOf(unsigned.txID, signed.signature![0])).toBe(
      'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
    );
  });

  it('zeroes the decrypted material after signing', async () => {
    const { signer, decrypted } = build();

    await signer.sign(transaction(), { kind: 'hot' });
    await signer.sign(transaction(), { kind: 'deposit', derivationIndex: 0 });

    expect(decrypted).toHaveLength(2);
    for (const buffer of decrypted) {
      expect(buffer.every((byte) => byte === 0)).toBe(true);
    }
  });
});
