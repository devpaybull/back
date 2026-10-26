import { Logger } from '@nestjs/common';
import { TronWeb } from 'tronweb';
import { toCrypto } from '../../common/utils/to-crypto';
import { TronAddress } from '../entities/tron-address.entity';
import { TronScanCursor } from '../entities/tron-scan-cursor.entity';
import { UsdtTransferScanner } from '../services/usdt-transfer-scanner.service';
import { AddressPurpose } from '../types/address-purpose.enum';
import { TronTransactionInfo } from '../types/tron-transaction-info';
import { TronUnavailableError } from '../types/tron-unavailable.error';
import { USDT_TRANSFER_TOPIC } from '../utils/usdt-transfer-topic';

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const DEPOSIT = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const HOT = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
const STRANGER = 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK';

const topicOf = (address: string) =>
  TronWeb.address.toHex(address).slice(2).padStart(64, '0');

const transferInfo = (
  to: string,
  sun: bigint,
  result = 'SUCCESS',
  id = 'aa'.repeat(32),
): TronTransactionInfo => ({
  id,
  blockTimeStamp: 1_700_000_000_000,
  receipt: { result },
  log: [
    {
      address: TronWeb.address.toHex(USDT).slice(2),
      topics: [USDT_TRANSFER_TOPIC, topicOf(STRANGER), topicOf(to)],
      data: sun.toString(16).padStart(64, '0'),
    },
  ],
});

const build = (options: {
  solidified: number;
  lastBlock: number | null;
  blocks?: Record<number, TronTransactionInfo[]>;
  addresses?: Partial<TronAddress>[];
  config?: Record<string, unknown>;
}) => {
  const cursor = {
    id: 1,
    singleton: true,
    network: 'nile',
    lastBlock: String(options.lastBlock ?? options.solidified),
  } as TronScanCursor;
  const values: Record<string, unknown> = {
    TRON_NETWORK: 'nile',
    TRON_USDT_CONTRACT: USDT,
    TRON_SCAN_BATCH_BLOCKS: 100,
    TRON_SCAN_MAX_LAG_BLOCKS: 200,
    ...options.config,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => values[key]),
  };
  const node = {
    getSolidifiedBlockNumber: jest.fn(async () => options.solidified),
    getSolidifiedTransactionInfos: jest.fn(
      async (block: number) => options.blocks?.[block] ?? [],
    ),
    getSolidifiedBlockTransactionCount: jest.fn(
      async (block: number) => options.blocks?.[block]?.length ?? 0,
    ),
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
  const lockedCursor = { value: cursor as TronScanCursor | null };
  const locking = {
    setLock: jest.fn(),
    setOnLocked: jest.fn(),
    where: jest.fn(),
    getOne: jest.fn(async () => lockedCursor.value),
  };
  locking.setLock.mockReturnValue(locking);
  locking.setOnLocked.mockReturnValue(locking);
  locking.where.mockReturnValue(locking);
  const addresses = (options.addresses ?? []).map(
    (row) => ({ ...row }) as TronAddress,
  );
  const update = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    setParameter: jest.fn(),
    execute: jest.fn(async () => undefined),
  };
  update.update.mockReturnValue(update);
  update.set.mockReturnValue(update);
  update.where.mockReturnValue(update);
  update.setParameter.mockReturnValue(update);
  const manager = {
    createQueryBuilder: jest.fn(() => update),
    getRepository: jest.fn(() => ({ createQueryBuilder: () => locking })),
    find: jest.fn(async () => addresses),
    save: jest.fn(async (row: unknown) => row),
  };
  const dataSource = {
    createQueryBuilder: jest.fn(() => insert),
    getRepository: jest.fn(() => ({
      findOneOrFail: jest.fn(async () => ({ ...cursor })),
    })),
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const scanner = new UsdtTransferScanner(
    config as never,
    node as never,
    dataSource as never,
  );

  return {
    scanner,
    node,
    insert,
    manager,
    cursor,
    lockedCursor,
    locking,
    addresses,
    dataSource,
    update,
  };
};

describe('UsdtTransferScanner', () => {
  it('starts the cursor at the solidified head the first time, scanning nothing old', async () => {
    const { scanner, insert, node } = build({
      solidified: 500,
      lastBlock: null,
    });

    await expect(scanner.run()).resolves.toBe(0);

    expect(insert.into).toHaveBeenCalledWith(TronScanCursor);
    expect(insert.values).toHaveBeenCalledWith({
      singleton: true,
      network: 'nile',
      lastBlock: '500',
    });
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(node.getSolidifiedTransactionInfos).not.toHaveBeenCalled();
  });

  it('advances one block per transaction up to the solidified head and no further', async () => {
    const { scanner, node, cursor, dataSource, locking } = build({
      solidified: 103,
      lastBlock: 100,
    });

    await expect(scanner.run()).resolves.toBe(3);

    expect(
      node.getSolidifiedTransactionInfos.mock.calls.map(([block]) => block),
    ).toEqual([101, 102, 103]);
    expect(dataSource.transaction).toHaveBeenCalledTimes(3);
    expect(cursor.lastBlock).toBe('103');
    expect(locking.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(locking.setOnLocked).toHaveBeenCalledWith('skip_locked');
  });

  it('stops after the batch size', async () => {
    const { scanner, node } = build({
      solidified: 1000,
      lastBlock: 100,
      config: { TRON_SCAN_BATCH_BLOCKS: 2 },
    });

    await expect(scanner.run()).resolves.toBe(2);
    expect(node.getSolidifiedTransactionInfos).toHaveBeenCalledTimes(2);
  });

  it('stops when another instance holds the cursor', async () => {
    const { scanner, lockedCursor } = build({
      solidified: 103,
      lastBlock: 100,
    });
    lockedCursor.value = null;

    await expect(scanner.run()).resolves.toBe(0);
  });

  it('stops when the cursor moved since it was read', async () => {
    const { scanner, cursor, dataSource } = build({
      solidified: 103,
      lastBlock: 100,
    });
    dataSource.getRepository.mockReturnValue({
      findOneOrFail: jest.fn(async () => ({ ...cursor, lastBlock: '100' })),
    });
    cursor.lastBlock = '101';

    await expect(scanner.run()).resolves.toBe(0);
    expect(cursor.lastBlock).toBe('101');
  });

  it('hands a transfer to the handler of the address purpose in the same manager', async () => {
    const deposit = {
      id: 3,
      address: DEPOSIT,
      purpose: AddressPurpose.Deposit,
      unsweptAmount: toCrypto('1.5'),
      lastIncomingAt: null,
    };
    const { scanner, manager, update } = build({
      solidified: 101,
      lastBlock: 100,
      blocks: { 101: [transferInfo(DEPOSIT, 12_500_000n)] },
      addresses: [deposit],
    });
    const handler = jest.fn(async () => undefined);
    scanner.register(AddressPurpose.Deposit, handler);

    await scanner.run();

    expect(handler).toHaveBeenCalledTimes(1);
    const [handedManager, event, address] = handler.mock
      .calls[0] as unknown as [
      unknown,
      {
        to: string;
        blockNumber: number;
        amount: { toFixed: (n: number) => string };
      },
      TronAddress,
    ];
    expect(handedManager).toBe(manager);
    expect(event.to).toBe(DEPOSIT);
    expect(event.blockNumber).toBe(101);
    expect(event.amount.toFixed(6)).toBe('12.500000');
    expect(address.id).toBe(3);
    expect(update.update).toHaveBeenCalledWith(TronAddress);
    const [set] = update.set.mock.calls[0] as unknown as [
      { unsweptAmount: () => string; lastIncomingAt: Date },
    ];
    expect(set.unsweptAmount()).toBe('"unsweptAmount" + :amount');
    expect(set.lastIncomingAt).toEqual(new Date(1_700_000_000_000));
    expect(update.where).toHaveBeenCalledWith('id = :id', { id: 3 });
    expect(update.setParameter).toHaveBeenCalledWith('amount', '12.500000');
    expect(manager.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ address: DEPOSIT }),
    );
  });

  it('ignores failed transactions and transfers to addresses that are not ours', async () => {
    const { scanner, manager } = build({
      solidified: 101,
      lastBlock: 100,
      blocks: {
        101: [
          transferInfo(DEPOSIT, 1n, 'REVERT', 'bb'.repeat(32)),
          transferInfo(STRANGER, 1n, 'SUCCESS', 'cc'.repeat(32)),
        ],
      },
      addresses: [],
    });
    const handler = jest.fn();
    scanner.register(AddressPurpose.Deposit, handler);

    await scanner.run();

    expect(manager.find).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('logs a transfer to a wallet without a handler and does not touch its counters', async () => {
    const hot = {
      id: 1,
      address: HOT,
      purpose: AddressPurpose.Hot,
      unsweptAmount: toCrypto(0),
      lastIncomingAt: null,
    };
    const { scanner, addresses, update } = build({
      solidified: 101,
      lastBlock: 100,
      blocks: { 101: [transferInfo(HOT, 5n)] },
      addresses: [hot],
    });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await scanner.run();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('hot wallet'));
    expect(addresses[0].unsweptAmount.toFixed(6)).toBe('0.000000');
    expect(update.execute).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('keeps the cursor where it was when a handler throws, and the tick reports nothing', async () => {
    const { scanner, cursor } = build({
      solidified: 101,
      lastBlock: 100,
      blocks: { 101: [transferInfo(DEPOSIT, 1n)] },
      addresses: [
        {
          id: 3,
          address: DEPOSIT,
          purpose: AddressPurpose.Deposit,
          unsweptAmount: toCrypto(0),
        },
      ],
    });
    scanner.register(AddressPurpose.Deposit, async () => {
      throw new Error('handler failed');
    });
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(scanner.tick()).resolves.toBe(0);

    expect(cursor.lastBlock).toBe('100');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('handler failed'),
    );
    error.mockRestore();
  });

  it('warns on every tick it is further behind than the configured lag', async () => {
    const { scanner } = build({
      solidified: 1000,
      lastBlock: 100,
      config: { TRON_SCAN_BATCH_BLOCKS: 1, TRON_SCAN_MAX_LAG_BLOCKS: 200 },
    });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await scanner.run();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('900 blocks behind'),
    );
    warn.mockRestore();
  });

  it('refuses a block whose transaction infos do not match its transaction count, keeping the cursor', async () => {
    const { scanner, node, cursor, dataSource } = build({
      solidified: 101,
      lastBlock: 100,
      blocks: { 101: [transferInfo(DEPOSIT, 1n)] },
    });
    node.getSolidifiedBlockTransactionCount.mockResolvedValue(2);

    await expect(scanner.run()).rejects.toBeInstanceOf(TronUnavailableError);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(cursor.lastBlock).toBe('100');
  });

  it('refuses to scan with a cursor that belongs to another network', async () => {
    const { scanner, node } = build({
      solidified: 101,
      lastBlock: 100,
      config: { TRON_NETWORK: 'mainnet' },
    });

    await expect(scanner.run()).rejects.toThrow(/belongs to nile/);
    expect(node.getSolidifiedTransactionInfos).not.toHaveBeenCalled();
  });

  it('does not run twice at once', async () => {
    const { scanner, node } = build({ solidified: 100, lastBlock: 100 });
    let release: () => void = () => undefined;
    node.getSolidifiedBlockNumber.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(100))),
    );

    const first = scanner.tick();
    await expect(scanner.tick()).resolves.toBe(0);
    release();
    await first;

    expect(node.getSolidifiedBlockNumber).toHaveBeenCalledTimes(1);
  });
});
