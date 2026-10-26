import { Logger } from '@nestjs/common';
import { TronAddress } from '../entities/tron-address.entity';
import { TronKeyring } from '../services/tron-keyring.service';
import { AddressPurpose } from '../types/address-purpose.enum';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HOT_KEY = '0x' + '0'.repeat(63) + '1';
const ENERGY_KEY = '0'.repeat(63) + '2';
const HOT_ADDRESS = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
const ENERGY_ADDRESS = 'TDvSsdrNM5eeXNL3czpa6AxLDHZA9nwe9K';

const CIPHERTEXTS: Record<string, string> = {
  TRON_DEPOSIT_SEED_CIPHERTEXT: 'vault:v1:seed',
  TRON_HOT_KEY_CIPHERTEXT: 'vault:v1:hot',
  TRON_ENERGY_KEY_CIPHERTEXT: 'vault:v1:energy',
};
const PLAINTEXTS: Record<string, string> = {
  'vault:v1:seed': `${MNEMONIC}\n`,
  'vault:v1:hot': HOT_KEY,
  'vault:v1:energy': ENERGY_KEY,
};

const build = () => {
  const decrypted: Buffer[] = [];
  const vault = {
    decrypt: jest.fn(async (ciphertext: string) => {
      const buffer = Buffer.from(PLAINTEXTS[ciphertext], 'utf8');
      decrypted.push(buffer);
      return buffer;
    }),
  };
  const insert = {
    insert: jest.fn(),
    into: jest.fn(),
    values: jest.fn(),
    orIgnore: jest.fn(),
    execute: jest.fn(async () => undefined),
  };
  insert.insert.mockReturnValue(insert);
  insert.into.mockReturnValue(insert);
  insert.values.mockReturnValue(insert);
  insert.orIgnore.mockReturnValue(insert);
  const dataSource = { createQueryBuilder: jest.fn(() => insert) };
  const config = { getOrThrow: jest.fn((key: string) => CIPHERTEXTS[key]) };
  const keyring = new TronKeyring(
    config as never,
    vault as never,
    dataSource as never,
  );

  return { keyring, vault, insert, decrypted };
};

describe('TronKeyring', () => {
  it('derives the hot and energy addresses from their decrypted keys', async () => {
    const { keyring } = build();

    await expect(keyring.hotAddress()).resolves.toBe(HOT_ADDRESS);
    await expect(keyring.energyAddress()).resolves.toBe(ENERGY_ADDRESS);
  });

  it('derives deposit addresses from the decrypted seed', async () => {
    const { keyring } = build();

    await expect(keyring.depositAddressAt(0)).resolves.toBe(
      'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
    );
    await expect(keyring.depositAddressAt(1)).resolves.toBe(
      'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
    );
  });

  it('decrypts once, zeroes every decrypted buffer, and keeps only public data', async () => {
    const { keyring, vault, decrypted } = build();

    await keyring.hotAddress();
    await keyring.depositAddressAt(3);
    await keyring.energyAddress();

    expect(vault.decrypt).toHaveBeenCalledTimes(3);
    expect(decrypted).toHaveLength(3);
    for (const buffer of decrypted) {
      expect(buffer.every((byte) => byte === 0)).toBe(true);
    }
    expect(JSON.stringify(keyring)).not.toContain('abandon');
  });

  it('registers the hot and the energy wallet as platform addresses, ignoring a repeat', async () => {
    const { keyring, insert } = build();

    await keyring.hotAddress();

    expect(insert.into).toHaveBeenCalledWith(TronAddress);
    expect(insert.values).toHaveBeenCalledWith({
      address: HOT_ADDRESS,
      purpose: AddressPurpose.Hot,
      derivationIndex: null,
    });
    expect(insert.values).toHaveBeenCalledWith({
      address: ENERGY_ADDRESS,
      purpose: AddressPurpose.Energy,
      derivationIndex: null,
    });
    expect(insert.orIgnore).toHaveBeenCalledTimes(2);
  });

  it('tries the load again after a failure instead of caching the error', async () => {
    const { keyring, vault } = build();
    vault.decrypt.mockRejectedValueOnce(new Error('vault down'));

    await expect(keyring.hotAddress()).rejects.toThrow('vault down');
    await expect(keyring.hotAddress()).resolves.toBe(HOT_ADDRESS);
  });

  it('refuses a key ciphertext that does not hold a private key', async () => {
    const { keyring, vault } = build();
    vault.decrypt.mockImplementation(async (ciphertext: string) =>
      Buffer.from(
        ciphertext === 'vault:v1:hot' ? 'not a key' : PLAINTEXTS[ciphertext],
      ),
    );

    await expect(keyring.hotAddress()).rejects.toThrow();
  });

  describe('issueDepositAddress', () => {
    const managerWith = (last: Partial<TronAddress> | null) => ({
      query: jest.fn(async () => undefined),
      findOne: jest.fn(async () => last),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn(async (row: object) => ({ id: 9, ...row })),
    });

    it('takes the advisory lock first and starts at index 0', async () => {
      const { keyring } = build();
      const manager = managerWith(null);

      const issued = await keyring.issueDepositAddress(manager as never);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['tron_addresses:deposit'],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        manager.findOne.mock.invocationCallOrder[0],
      );
      expect(manager.findOne).toHaveBeenCalledWith(TronAddress, {
        where: { purpose: AddressPurpose.Deposit },
        order: { derivationIndex: 'DESC' },
      });
      expect(issued).toEqual(
        expect.objectContaining({
          address: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
          derivationIndex: 0,
          purpose: AddressPurpose.Deposit,
        }),
      );
    });

    it('continues from the highest index already issued', async () => {
      const { keyring } = build();
      const manager = managerWith({ derivationIndex: 0 });

      const issued = await keyring.issueDepositAddress(manager as never);

      expect(issued.derivationIndex).toBe(1);
      expect(issued.address).toBe('TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK');
    });
  });

  it('never hands the mnemonic or a private key to the logger', async () => {
    const spies = (
      ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const
    ).map((method) =>
      jest.spyOn(Logger.prototype, method).mockImplementation(),
    );
    const { keyring } = build();

    await keyring.hotAddress();
    await keyring.depositAddressAt(0);

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain('abandon');
    expect(logged).not.toContain(HOT_KEY.slice(2));
    expect(logged).not.toContain(ENERGY_KEY);
    spies.forEach((spy) => spy.mockRestore());
  });
});
