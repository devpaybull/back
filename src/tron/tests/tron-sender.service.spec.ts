import { TronWeb } from 'tronweb';
import { toCrypto } from '../../common/utils/to-crypto';
import { TronOutgoingTransfer } from '../entities/tron-outgoing-transfer.entity';
import { TronSender } from '../services/tron-sender.service';
import { OutgoingTransferKind } from '../types/outgoing-transfer-kind.enum';
import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';
import { TronTransaction } from '../types/tron-transaction';
import { serializedTransaction } from './serialized-transaction.spec';
import { TronUnavailableError } from '../types/tron-unavailable.error';

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const HOT = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
const ENERGY = 'TDvSsdrNM5eeXNL3czpa6AxLDHZA9nwe9K';
const TO = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const OTHER = 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK';

const usdtData = (to: string, sun: bigint) =>
  'a9059cbb' +
  TronWeb.address.toHex(to).slice(2).padStart(64, '0') +
  sun.toString(16).padStart(64, '0');

const built = (
  type: string,
  value: Record<string, unknown>,
  feeLimit?: number,
): TronTransaction => serializedTransaction(type, value, { feeLimit });

const usdtBuilt = (
  overrides: Partial<{
    to: string;
    sun: bigint;
    contract: string;
    feeLimit: number;
    owner: string;
  }> = {},
) =>
  built(
    'TriggerSmartContract',
    {
      owner_address: overrides.owner ?? HOT,
      contract_address: overrides.contract ?? USDT,
      data: usdtData(overrides.to ?? TO, overrides.sun ?? 12_500_000n),
    },
    overrides.feeLimit ?? 30_000_000,
  );

const build = (existing: Partial<TronOutgoingTransfer> | null = null) => {
  const rows: TronOutgoingTransfer[] = [];
  const insert = {
    insert: jest.fn(),
    values: jest.fn((values: Partial<TronOutgoingTransfer>) => {
      rows.push({ id: 1, ...values } as TronOutgoingTransfer);
      return insert;
    }),
    orIgnore: jest.fn(),
    execute: jest.fn(async () => ({ raw: [{ id: 1 }], identifiers: [] })),
  };
  insert.insert.mockReturnValue(insert);
  insert.orIgnore.mockReturnValue(insert);
  const snapshots: TronOutgoingTransfer[] = [];
  const repository = {
    findOne: jest.fn(async () => existing),
    createQueryBuilder: jest.fn(() => insert),
    findOneOrFail: jest.fn(async () => rows[0]),
    save: jest.fn(async (row: TronOutgoingTransfer) => {
      snapshots.push({ ...row });
      return { ...row };
    }),
  };
  const dataSource = { getRepository: jest.fn(() => repository) };
  const node = {
    buildUsdtTransfer: jest.fn(async () => usdtBuilt()),
    buildTrxTransfer: jest.fn(),
    buildEnergyDelegation: jest.fn(),
    buildEnergyUndelegation: jest.fn(),
    broadcast: jest.fn(async () => undefined),
  };
  const keyring = {
    hotAddress: jest.fn(async () => HOT),
    energyAddress: jest.fn(async () => ENERGY),
    depositAddressAt: jest.fn(async () => TO),
  };
  const signer = {
    sign: jest.fn(async (transaction: TronTransaction) => ({
      ...transaction,
      signature: ['sig'],
    })),
  };
  const config = {
    getOrThrow: jest.fn(
      (key: string) =>
        ({ TRON_MAX_TRX_BURN_PER_TX: '30', TRON_USDT_CONTRACT: USDT })[key],
    ),
  };
  const sender = new TronSender(
    config as never,
    node as never,
    keyring as never,
    signer,
    dataSource as never,
  );

  return { sender, node, signer, repository, insert, rows, snapshots };
};

const usdtInput = {
  idempotencyKey: 'withdrawal:1:1',
  from: { kind: 'hot' as const },
  to: TO,
  amount: toCrypto('12.5'),
};

describe('TronSender', () => {
  it('returns the stored row for a known key and builds nothing', async () => {
    const stored = {
      id: 5,
      idempotencyKey: 'withdrawal:1:1',
      status: OutgoingTransferStatus.Broadcast,
    };
    const { sender, node, signer } = build(stored);

    await expect(sender.sendUsdt(usdtInput)).resolves.toBe(stored);
    expect(node.buildUsdtTransfer).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('returns the row another sender inserted first, without building', async () => {
    const { sender, insert, node, rows } = build();
    insert.execute.mockResolvedValue({ raw: [], identifiers: [] });

    const row = await sender.sendUsdt(usdtInput);

    expect(row).toBe(rows[0]);
    expect(node.buildUsdtTransfer).not.toHaveBeenCalled();
  });

  it('records the row as building with the amount in sun and the fee limit', async () => {
    const { sender, insert } = build();

    await sender.sendUsdt(usdtInput);

    expect(insert.values).toHaveBeenCalledWith({
      idempotencyKey: 'withdrawal:1:1',
      kind: OutgoingTransferKind.Usdt,
      fromAddress: HOT,
      toAddress: TO,
      amountSun: '12500000',
      feeLimitSun: '30000000',
      status: OutgoingTransferStatus.Building,
    });
    expect(insert.orIgnore).toHaveBeenCalled();
  });

  it('signs, stores the hash and the expiry, then broadcasts', async () => {
    const { sender, node, signer, repository, snapshots } = build();

    const row = await sender.sendUsdt(usdtInput);

    expect(node.buildUsdtTransfer).toHaveBeenCalledWith(
      HOT,
      TO,
      '12500000',
      '30000000',
    );
    expect(signer.sign).toHaveBeenCalledWith(expect.anything(), {
      kind: 'hot',
    });
    expect(snapshots[0]).toEqual(
      expect.objectContaining({
        txHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        status: OutgoingTransferStatus.Signed,
        expiresAt: expect.any(Date),
      }),
    );
    expect(repository.save.mock.invocationCallOrder[0]).toBeLessThan(
      node.broadcast.mock.invocationCallOrder[0],
    );
    expect(row.status).toBe(OutgoingTransferStatus.Broadcast);
    expect(row.broadcastAt).toBeInstanceOf(Date);
  });

  it('leaves the row signed when the broadcast fails, for the tracker to settle', async () => {
    const { sender, node } = build();
    node.broadcast.mockRejectedValue(new TronUnavailableError('down'));

    const row = await sender.sendUsdt(usdtInput);

    expect(row.status).toBe(OutgoingTransferStatus.Signed);
    expect(row.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['another recipient', usdtBuilt({ to: OTHER })],
    ['another amount', usdtBuilt({ sun: 12_500_001n })],
    ['another contract', usdtBuilt({ contract: OTHER })],
    ['another fee limit', usdtBuilt({ feeLimit: 31_000_000 })],
    ['another sender', usdtBuilt({ owner: OTHER })],
    [
      'another contract type',
      built('TransferContract', { owner_address: HOT }),
    ],
    [
      'a raw_data_hex that encodes another transfer than its raw_data',
      {
        ...usdtBuilt(),
        raw_data_hex: usdtBuilt({ to: OTHER }).raw_data_hex,
        txID: usdtBuilt({ to: OTHER }).txID,
      },
    ],
    [
      'TRX attached to the call',
      serializedTransaction(
        'TriggerSmartContract',
        {
          owner_address: HOT,
          contract_address: USDT,
          data: usdtData(TO, 12_500_000n),
          call_value: 5,
        },
        { feeLimit: 30_000_000 },
      ),
    ],
    [
      'an expiration already past',
      serializedTransaction(
        'TriggerSmartContract',
        {
          owner_address: HOT,
          contract_address: USDT,
          data: usdtData(TO, 12_500_000n),
        },
        { feeLimit: 30_000_000, expiration: Date.now() - 1000 },
      ),
    ],
    [
      'an expiration hours away',
      serializedTransaction(
        'TriggerSmartContract',
        {
          owner_address: HOT,
          contract_address: USDT,
          data: usdtData(TO, 12_500_000n),
        },
        { feeLimit: 30_000_000, expiration: Date.now() + 3_600_000 },
      ),
    ],
  ])(
    'refuses a built transaction with %s and signs nothing',
    async (_case, tampered) => {
      const { sender, node, signer, repository } = build();
      node.buildUsdtTransfer.mockResolvedValue(tampered);

      await expect(sender.sendUsdt(usdtInput)).rejects.toThrow(
        /other than the one requested/,
      );
      expect(signer.sign).not.toHaveBeenCalled();
      expect(node.broadcast).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OutgoingTransferStatus.Failed,
          failureReason: expect.stringMatching(/^not sent: /),
        }),
      );
    },
  );

  it('marks the row failed and rethrows when the node cannot build', async () => {
    const { sender, node, repository } = build();
    node.buildUsdtTransfer.mockRejectedValue(new TronUnavailableError('down'));

    await expect(sender.sendUsdt(usdtInput)).rejects.toBeInstanceOf(
      TronUnavailableError,
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OutgoingTransferStatus.Failed }),
    );
  });

  it('checks a TRX transfer against its recipient and amount', async () => {
    const { sender, node } = build();
    node.buildTrxTransfer.mockResolvedValue(
      built('TransferContract', {
        owner_address: HOT,
        to_address: TO,
        amount: 1,
      }),
    );

    const row = await sender.sendTrx({
      idempotencyKey: 'sweep:1:0:activate',
      from: { kind: 'hot' },
      to: TO,
      amount: toCrypto('0.000001'),
    });

    expect(node.buildTrxTransfer).toHaveBeenCalledWith(HOT, TO, '1');
    expect(row.status).toBe(OutgoingTransferStatus.Broadcast);
  });

  it('delegates energy from the energy wallet and checks the resource', async () => {
    const { sender, node, signer } = build();
    node.buildEnergyDelegation.mockResolvedValue(
      built('DelegateResourceContract', {
        owner_address: ENERGY,
        receiver_address: TO,
        balance: 2_000_000,
        resource: 'BANDWIDTH',
      }),
    );

    await expect(
      sender.delegateEnergy({
        idempotencyKey: 'sweep:1:0:delegate',
        receiver: TO,
        balanceSun: '2000000',
      }),
    ).rejects.toThrow(/other than the one requested/);
    expect(node.buildEnergyDelegation).toHaveBeenCalledWith(
      ENERGY,
      TO,
      '2000000',
    );
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('signs an undelegation with the energy key', async () => {
    const { sender, node, signer } = build();
    node.buildEnergyUndelegation.mockResolvedValue(
      built('UnDelegateResourceContract', {
        owner_address: ENERGY,
        receiver_address: TO,
        balance: 2_000_000,
        resource: 'ENERGY',
      }),
    );

    await sender.undelegateEnergy({
      idempotencyKey: 'sweep:1:0:undelegate',
      receiver: TO,
      balanceSun: '2000000',
    });

    expect(signer.sign).toHaveBeenCalledWith(expect.anything(), {
      kind: 'energy',
    });
  });

  it('sends from a deposit address with its derivation index', async () => {
    const { sender, node, signer } = build();
    node.buildUsdtTransfer.mockResolvedValue(usdtBuilt({ owner: TO, to: HOT }));

    await sender.sendUsdt({
      idempotencyKey: 'sweep:1:0:usdt',
      from: { kind: 'deposit', derivationIndex: 4 },
      to: HOT,
      amount: toCrypto('12.5'),
    });

    expect(signer.sign).toHaveBeenCalledWith(expect.anything(), {
      kind: 'deposit',
      derivationIndex: 4,
    });
  });
});
