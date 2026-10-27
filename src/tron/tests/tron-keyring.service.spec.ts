import { Logger } from '@nestjs/common';
import { TronAddress } from '../entities/tron-address.entity';
import { TronKeyring } from '../services/tron-keyring.service';
import { AddressPurpose } from '../types/address-purpose.enum';
import { KeyKind } from '../types/key-kind';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HOT_KEY = '0x' + '0'.repeat(63) + '1';
const ENERGY_KEY = '0'.repeat(63) + '2';
const HOT_ADDRESS = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
const ENERGY_ADDRESS = 'TDvSsdrNM5eeXNL3czpa6AxLDHZA9nwe9K';

const PLAINTEXTS: Record<KeyKind, string> = {
  deposit: `${MNEMONIC}\n`,
  hot: HOT_KEY,
  energy: ENERGY_KEY,
};

const build = () => {
  const decrypted: Buffer[] = [];
  const keys = {
    read: jest.fn(async (kind: KeyKind) => {
      const buffer = Buffer.from(PLAINTEXTS[kind], 'utf8');
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
  const keyring = new TronKeyring(keys, dataSource as never);

  return { keyring, keys, insert, decrypted };
};

describe('TronKeyring', () => {
  it('derives the hot and energy addresses from their keys', async () => {
    const { keyring } = build();

    await expect(keyring.hotAddress()).resolves.toBe(HOT_ADDRESS);
    await expect(keyring.energyAddress()).resolves.toBe(ENERGY_ADDRESS);
  });

  it('derives deposit addresses from the seed', async () => {
    const { keyring } = build();

    await expect(keyring.depositAddressAt(0)).resolves.toBe(
      'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
    );
    await expect(keyring.depositAddressAt(1)).resolves.toBe(
      'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
    );
  });

  it('reads the keys once, zeroes every buffer, and keeps only public data', async () => {
    const { keyring, keys, decrypted } = build();

    await keyring.hotAddress();
    await keyring.depositAddressAt(3);
    await keyring.energyAddress();

    expect(keys.read).toHaveBeenCalledTimes(3);
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
    const { keyring, keys } = build();
    keys.read.mockRejectedValueOnce(new Error('vault down'));

    await expect(keyring.hotAddress()).rejects.toThrow('vault down');
    await expect(keyring.hotAddress()).resolves.toBe(HOT_ADDRESS);
  });

  it('refuses key material that is not a private key', async () => {
    const { keyring, keys } = build();
    keys.read.mockImplementation(async (kind: KeyKind) =>
      Buffer.from(kind === 'hot' ? 'not a key' : PLAINTEXTS[kind]),
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
