import { TronOutgoingTransfer } from '../entities/tron-outgoing-transfer.entity';
import { TronConfirmationTracker } from '../services/tron-confirmation-tracker.service';
import { OutgoingTransferKind } from '../types/outgoing-transfer-kind.enum';
import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';
import { TronTransactionInfo } from '../types/tron-transaction-info';

const NOW = new Date('2026-10-25T12:00:00.000Z');

const transfer = (
  id: number,
  overrides: Partial<TronOutgoingTransfer> = {},
): TronOutgoingTransfer =>
  ({
    id,
    idempotencyKey: `withdrawal:${id}:1`,
    kind: OutgoingTransferKind.Usdt,
    status: OutgoingTransferStatus.Broadcast,
    txHash: `${id}`.padStart(64, '0'),
    expiresAt: new Date(NOW.getTime() - 120_000),
    failureReason: null,
    ...overrides,
  }) as TronOutgoingTransfer;

const build = (
  pending: TronOutgoingTransfer[],
  abandoned: TronOutgoingTransfer[] = [],
) => {
  const byId = new Map([...pending, ...abandoned].map((row) => [row.id, row]));
  const repository = {
    find: jest.fn(async (options: { where: { status: unknown } }) =>
      options.where.status === OutgoingTransferStatus.Building
        ? abandoned
        : pending,
    ),
  };
  const manager = {
    findOne: jest.fn(
      async (_entity: unknown, options: { where: { id: number } }) =>
        byId.get(options.where.id) ?? null,
    ),
    save: jest.fn(async (row: unknown) => row),
  };
  const dataSource = {
    getRepository: jest.fn(() => repository),
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const node = {
    getSolidifiedTransactionInfo: jest.fn(
      async (): Promise<TronTransactionInfo | null> => null,
    ),
    getTransaction: jest.fn(async (): Promise<object | null> => null),
  };
  const config = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  };
  const tracker = new TronConfirmationTracker(
    config as never,
    node as never,
    dataSource as never,
  );

  return { tracker, node, manager, repository };
};

describe('TronConfirmationTracker', () => {
  it('confirms a successful solidified transaction with its resource usage', async () => {
    const row = transfer(1);
    const { tracker, node } = build([row]);
    node.getSolidifiedTransactionInfo.mockResolvedValue({
      id: row.txHash!,
      blockNumber: 900,
      blockTimeStamp: 1_700_000_000_000,
      fee: 345_000,
      receipt: {
        result: 'SUCCESS',
        energy_usage: 64_000,
        energy_usage_total: 65_000,
        net_usage: 345,
      },
    });

    await expect(tracker.run(NOW)).resolves.toBe(1);

    expect(row).toEqual(
      expect.objectContaining({
        status: OutgoingTransferStatus.Confirmed,
        blockNumber: '900',
        energyUsed: '65000',
        energyFromStake: '64000',
        trxBurnedSun: '345000',
        bandwidthUsed: '345',
        confirmedAt: new Date(1_700_000_000_000),
      }),
    );
  });

  it('fails a reverted transaction with the receipt as the reason', async () => {
    const row = transfer(1);
    const { tracker, node } = build([row]);
    node.getSolidifiedTransactionInfo.mockResolvedValue({
      id: row.txHash!,
      blockNumber: 900,
      receipt: { result: 'OUT_OF_ENERGY' },
    });

    await tracker.run(NOW);

    expect(row.status).toBe(OutgoingTransferStatus.Failed);
    expect(row.failureReason).toBe('OUT_OF_ENERGY');
  });

  it('expires a transaction five minutes past its expiry that neither the full nor the solidified node knows', async () => {
    const row = transfer(1, { expiresAt: new Date(NOW.getTime() - 301_000) });
    const { tracker } = build([row]);

    await tracker.run(NOW);

    expect(row.status).toBe(OutgoingTransferStatus.Expired);
  });

  it('waits inside the five-minute margin after the expiry', async () => {
    const row = transfer(1, { expiresAt: new Date(NOW.getTime() - 240_000) });
    const { tracker, node } = build([row]);

    await expect(tracker.run(NOW)).resolves.toBe(0);

    expect(row.status).toBe(OutgoingTransferStatus.Broadcast);
    expect(node.getTransaction).not.toHaveBeenCalled();
  });

  it('waits for a transaction the full node knows but has not solidified', async () => {
    const row = transfer(1);
    const { tracker, node } = build([row]);
    node.getTransaction.mockResolvedValue({ txID: row.txHash });

    await expect(tracker.run(NOW)).resolves.toBe(0);
    expect(row.status).toBe(OutgoingTransferStatus.Broadcast);
  });

  it('does not expire a transaction the solidified node knows at the second look', async () => {
    const row = transfer(1, { expiresAt: new Date(NOW.getTime() - 301_000) });
    const { tracker, node } = build([row]);
    node.getSolidifiedTransactionInfo
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: row.txHash, blockNumber: 9 });

    await expect(tracker.run(NOW)).resolves.toBe(0);
    expect(row.status).toBe(OutgoingTransferStatus.Broadcast);
  });

  it('fails a row abandoned while building', async () => {
    const stuck = transfer(7, {
      status: OutgoingTransferStatus.Building,
      txHash: null,
    });
    const { tracker, repository } = build([], [stuck]);

    await expect(tracker.run(NOW)).resolves.toBe(1);

    expect(stuck.status).toBe(OutgoingTransferStatus.Failed);
    expect(stuck.failureReason).toMatch(/abandoned/);
    const [{ where }] = repository.find.mock.calls[0] as unknown as [
      { where: { createdAt: { value: Date } } },
    ];
    expect(where.createdAt.value).toEqual(new Date(NOW.getTime() - 600_000));
  });

  it('runs the handler of the key prefix in the same manager', async () => {
    const row = transfer(1, { idempotencyKey: 'sweep:3:0:usdt' });
    const { tracker, node, manager } = build([row]);
    node.getSolidifiedTransactionInfo.mockResolvedValue({
      id: row.txHash!,
      blockNumber: 900,
      receipt: { result: 'SUCCESS' },
    });
    const sweep = jest.fn(async () => undefined);
    const withdrawal = jest.fn(async () => undefined);
    tracker.register('sweep', sweep);
    tracker.register('withdrawal', withdrawal);

    await tracker.run(NOW);

    expect(sweep).toHaveBeenCalledWith(manager, row);
    expect(withdrawal).not.toHaveBeenCalled();
  });

  it('leaves a row another instance already finalized', async () => {
    const row = transfer(1);
    const { tracker, node, manager } = build([row]);
    node.getSolidifiedTransactionInfo.mockResolvedValue({
      id: row.txHash!,
      blockNumber: 900,
      receipt: { result: 'SUCCESS' },
    });
    manager.findOne.mockResolvedValue({
      ...row,
      status: OutgoingTransferStatus.Confirmed,
    });
    const handler = jest.fn();
    tracker.register('withdrawal', handler);

    await expect(tracker.run(NOW)).resolves.toBe(0);

    expect(manager.save).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
