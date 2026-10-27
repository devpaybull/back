import { TronWeb, utils } from 'tronweb';
import { LocalTransactionSigner } from '../services/local-transaction.signer';
import { KeyKind } from '../types/key-kind';
import { TronTransaction } from '../types/tron-transaction';
import { serializedTransaction } from './serialized-transaction.spec';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HOT_KEY = '0'.repeat(63) + '1';
const ENERGY_KEY = '0x' + '0'.repeat(63) + '2';
const PLAINTEXTS: Record<KeyKind, string> = {
  deposit: MNEMONIC,
  hot: `${HOT_KEY}\n`,
  energy: ENERGY_KEY,
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
  const keys = {
    read: jest.fn(async (kind: KeyKind) => {
      const buffer = Buffer.from(PLAINTEXTS[kind]);
      decrypted.push(buffer);
      return buffer;
    }),
  };

  return {
    signer: new LocalTransactionSigner(keys),
    keys,
    decrypted,
  };
};

describe('LocalTransactionSigner', () => {
  it('refuses a transaction whose id is not the hash of its raw data', async () => {
    const { signer, keys } = build();

    await expect(
      signer.sign({ ...transaction(), txID: 'ff'.repeat(32) }, { kind: 'hot' }),
    ).rejects.toThrow(/does not match/);
    expect(keys.read).not.toHaveBeenCalled();
  });

  it('refuses a raw_data that does not encode to its raw_data_hex', async () => {
    const { signer, keys } = build();
    const honest = transaction();
    const forged = {
      ...honest,
      raw_data: { ...honest.raw_data, fee_limit: 1 },
    };

    await expect(signer.sign(forged, { kind: 'hot' })).rejects.toThrow(
      /does not match/,
    );
    expect(keys.read).not.toHaveBeenCalled();
  });

  it('signs with the hot key so the signature recovers the hot address', async () => {
    const { signer, keys } = build();
    const unsigned = transaction();

    const signed = await signer.sign(unsigned, { kind: 'hot' });

    expect(keys.read).toHaveBeenCalledWith('hot');
    expect(signed.signature).toHaveLength(1);
    expect(signerOf(unsigned.txID, signed.signature![0])).toBe(
      TronWeb.address.fromPrivateKey(HOT_KEY),
    );
  });

  it('signs with the energy key', async () => {
    const { signer, keys } = build();
    const unsigned = transaction();

    const signed = await signer.sign(unsigned, { kind: 'energy' });

    expect(keys.read).toHaveBeenCalledWith('energy');
    expect(signerOf(unsigned.txID, signed.signature![0])).toBe(
      TronWeb.address.fromPrivateKey(ENERGY_KEY.slice(2)),
    );
  });

  it('signs a deposit address with the key derived from the seed at its index', async () => {
    const { signer, keys } = build();
    const unsigned = transaction();

    const signed = await signer.sign(unsigned, {
      kind: 'deposit',
      derivationIndex: 1,
    });

    expect(keys.read).toHaveBeenCalledWith('deposit');
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
