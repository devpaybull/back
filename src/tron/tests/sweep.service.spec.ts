import { Brackets } from 'typeorm';
import { toCrypto } from '../../common/utils/to-crypto';
import { TronAddress } from '../entities/tron-address.entity';
import { TronOutgoingTransfer } from '../entities/tron-outgoing-transfer.entity';
import { SweepService } from '../services/sweep.service';
import { AddressPurpose } from '../types/address-purpose.enum';
import { EnergyPlan } from '../types/energy-plan';
import { OutgoingTransferHandler } from '../types/outgoing-transfer-handler';
import { OutgoingTransferKind } from '../types/outgoing-transfer-kind.enum';
import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';

const HOT = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
const DEPOSIT = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const NOW = new Date('2026-10-25T12:00:00.000Z');

const address = (overrides: Partial<TronAddress> = {}): TronAddress =>
  ({
    id: 3,
    address: DEPOSIT,
    derivationIndex: 4,
    purpose: AddressPurpose.Deposit,
    activatedAt: new Date('2026-10-01T00:00:00.000Z'),
    unsweptAmount: toCrypto('120'),
    lastIncomingAt: new Date('2026-10-25T10:00:00.000Z'),
    lastSweptAt: null,
    sweepNonce: 2,
    sweepDelegatedSun: null,
    ...overrides,
  }) as TronAddress;

const build = (
  candidates: TronAddress[],
  options: {
    inFlight?: number;
    balanceSun?: string;
    activated?: boolean;
    plan?: EnergyPlan;
  } = {},
) => {
  const query = {
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn(async () => candidates),
  };
  for (const method of [
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'take',
  ] as const) {
    query[method].mockReturnValue(query);
  }
  const addresses = {
    createQueryBuilder: jest.fn(() => query),
    update: jest.fn(async () => undefined),
    increment: jest.fn(async () => undefined),
  };
  const outgoing = { count: jest.fn(async () => options.inFlight ?? 0) };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) =>
      entity === TronOutgoingTransfer ? outgoing : addresses,
    ),
  };
  const values: Record<string, unknown> = {
    SWEEP_MIN_USDT: '50',
    SWEEP_MAX_IDLE_HOURS: 24,
    SWEEP_BATCH_SIZE: 20,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => values[key]),
  };
  const node = {
    getUsdtBalanceSun: jest.fn(async () => options.balanceSun ?? '120000000'),
    isActivated: jest.fn(async () => options.activated ?? false),
  };
  const keyring = { hotAddress: jest.fn(async () => HOT) };
  const sender = {
    sendTrx: jest.fn(async () => ({})),
    sendUsdt: jest.fn(async () => ({})),
    delegateEnergy: jest.fn(async () => ({})),
    undelegateEnergy: jest.fn(async () => ({})),
  };
  const energy = {
    estimateUsdtTransfer: jest.fn(async () => ({
      energy: 65_000,
      bandwidth: 350,
      burnSun: '27650000',
    })),
    planForSweep: jest.fn(async () => options.plan ?? { action: 'ready' }),
  };
  let handler: OutgoingTransferHandler | null = null;
  const tracker = {
    register: jest.fn(
      (_prefix: string, registered: OutgoingTransferHandler) => {
        handler = registered;
      },
    ),
  };
  const service = new SweepService(
    config as never,
    node as never,
    keyring as never,
    sender as never,
    energy as never,
    tracker as never,
    dataSource as never,
  );

  return {
    service,
    query,
    addresses,
    outgoing,
    node,
    sender,
    energy,
    tracker,
    finalize: (manager: unknown, transfer: Partial<TronOutgoingTransfer>) =>
      handler!(manager as never, transfer as TronOutgoingTransfer),
  };
};

describe('SweepService', () => {
  it('registers for the sweep key prefix', () => {
    const { tracker } = build([]);

    expect(tracker.register).toHaveBeenCalledWith(
      'sweep',
      expect.any(Function),
    );
  });

  it('selects deposit addresses over the threshold, idle ones and delegated ones, largest first', async () => {
    const { service, query } = build([]);

    await service.run(NOW);

    expect(query.where).toHaveBeenCalledWith('address.purpose = :purpose', {
      purpose: AddressPurpose.Deposit,
    });
    const brackets = query.andWhere.mock.calls[0][0] as Brackets;
    const inner = { where: jest.fn(), orWhere: jest.fn() };
    inner.where.mockReturnValue(inner);
    inner.orWhere.mockReturnValue(inner);
    brackets.whereFactory(inner as never);
    expect(inner.where).toHaveBeenCalledWith(
      'address.unsweptAmount >= :minimum',
      {
        minimum: '50.000000',
      },
    );
    expect(inner.orWhere).toHaveBeenCalledWith(
      'address.unsweptAmount > 0 AND address.lastIncomingAt <= :idleSince',
      { idleSince: new Date(NOW.getTime() - 24 * 3_600_000) },
    );
    expect(inner.orWhere).toHaveBeenCalledWith(
      'address.sweepDelegatedSun IS NOT NULL',
    );
    expect(query.orderBy).toHaveBeenCalledWith('address.unsweptAmount', 'DESC');
    expect(query.take).toHaveBeenCalledWith(20);
  });

  it('skips an address with a step still in flight', async () => {
    const { service, sender, node } = build([address()], { inFlight: 1 });

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(node.getUsdtBalanceSun).not.toHaveBeenCalled();
    expect(sender.sendUsdt).not.toHaveBeenCalled();
  });

  it('resets the counter of an address whose on-chain balance is already zero', async () => {
    const { service, addresses, sender } = build([address()], {
      balanceSun: '0',
    });

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(addresses.update).toHaveBeenCalledWith(3, {
      unsweptAmount: toCrypto(0),
    });
    expect(sender.undelegateEnergy).not.toHaveBeenCalled();
  });

  it('takes the delegated energy back once the address is empty', async () => {
    const { service, sender } = build(
      [address({ sweepDelegatedSun: '13000000000' })],
      {
        balanceSun: '0',
      },
    );

    await service.run(NOW);

    expect(sender.undelegateEnergy).toHaveBeenCalledWith({
      idempotencyKey: 'sweep:3:2:undelegate',
      receiver: DEPOSIT,
      balanceSun: '13000000000',
    });
  });

  it('activates an address the network does not know with a minimal TRX transfer', async () => {
    const { service, sender } = build([address({ activatedAt: null })]);

    await service.run(NOW);

    expect(sender.sendTrx).toHaveBeenCalledWith({
      idempotencyKey: 'sweep:3:2:activate',
      from: { kind: 'hot' },
      to: DEPOSIT,
      amount: toCrypto('0.000001'),
    });
    expect(sender.sendUsdt).not.toHaveBeenCalled();
  });

  it('records the activation of an address that is already active and goes on', async () => {
    const { service, sender, addresses } = build(
      [address({ activatedAt: null })],
      {
        activated: true,
      },
    );

    await service.run(NOW);

    expect(addresses.update).toHaveBeenCalledWith(3, {
      activatedAt: expect.any(Date),
    });
    expect(sender.sendTrx).not.toHaveBeenCalled();
    expect(sender.sendUsdt).toHaveBeenCalled();
  });

  it('sends the whole on-chain balance to the hot wallet from the deposit key when ready', async () => {
    const { service, sender, energy } = build([address()], {
      balanceSun: '120500000',
    });

    await expect(service.run(NOW)).resolves.toBe(1);

    expect(energy.estimateUsdtTransfer).toHaveBeenCalledWith(
      DEPOSIT,
      HOT,
      toCrypto('120.5'),
    );
    expect(sender.sendUsdt).toHaveBeenCalledWith({
      idempotencyKey: 'sweep:3:2:usdt',
      from: { kind: 'deposit', derivationIndex: 4 },
      to: HOT,
      amount: toCrypto('120.5'),
    });
  });

  it('delegates energy and remembers how much', async () => {
    const { service, sender, addresses } = build([address()], {
      plan: { action: 'delegate', balanceSun: '13000000000' },
    });

    await service.run(NOW);

    expect(sender.delegateEnergy).toHaveBeenCalledWith({
      idempotencyKey: 'sweep:3:2:delegate',
      receiver: DEPOSIT,
      balanceSun: '13000000000',
    });
    expect(addresses.update).toHaveBeenCalledWith(3, {
      sweepDelegatedSun: '13000000000',
    });
  });

  it('does not remember a delegation the sender did not send, and moves to a fresh key', async () => {
    const { service, sender, addresses } = build([address()], {
      plan: { action: 'delegate', balanceSun: '13000000000' },
    });
    sender.delegateEnergy.mockResolvedValue({
      status: OutgoingTransferStatus.Failed,
      txHash: null,
    });

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(addresses.update).not.toHaveBeenCalled();
    expect(addresses.increment).toHaveBeenCalledWith(
      { id: 3 },
      'sweepNonce',
      1,
    );
  });

  it('bumps the nonce and gives up on the address for this run when a send throws', async () => {
    const { service, sender, addresses } = build([address()]);
    sender.sendUsdt.mockRejectedValue(new Error('vault down'));

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(addresses.increment).toHaveBeenCalledWith(
      { id: 3 },
      'sweepNonce',
      1,
    );
  });

  it('keeps the nonce for a step that was signed', async () => {
    const { service, sender, addresses } = build([address()]);
    sender.sendUsdt.mockResolvedValue({
      status: OutgoingTransferStatus.Broadcast,
      txHash: 'ab'.repeat(32),
    });

    await expect(service.run(NOW)).resolves.toBe(1);
    expect(addresses.increment).not.toHaveBeenCalled();
  });

  it('funds the burn from the hot wallet', async () => {
    const { service, sender } = build([address()], {
      plan: { action: 'burn', burnSun: '17650000' },
    });

    await service.run(NOW);

    expect(sender.sendTrx).toHaveBeenCalledWith({
      idempotencyKey: 'sweep:3:2:fund',
      from: { kind: 'hot' },
      to: DEPOSIT,
      amount: toCrypto('17.65'),
    });
  });

  it('sends nothing when the plan is to wait', async () => {
    const { service, sender } = build([address()], {
      plan: { action: 'wait' },
    });

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(sender.sendUsdt).not.toHaveBeenCalled();
    expect(sender.sendTrx).not.toHaveBeenCalled();
    expect(sender.delegateEnergy).not.toHaveBeenCalled();
  });

  it('postpones one address that fails and goes on with the next', async () => {
    const { service, sender, node } = build([address(), address({ id: 4 })]);
    node.getUsdtBalanceSun.mockRejectedValueOnce(new Error('node down'));

    await expect(service.run(NOW)).resolves.toBe(1);
    expect(sender.sendUsdt).toHaveBeenCalledTimes(1);
  });

  describe('when a step is final', () => {
    const managerWith = (row: TronAddress | null) => ({
      findOne: jest.fn(async () => row),
      save: jest.fn(async (saved: unknown) => saved),
    });

    it('subtracts the swept amount, never below zero, and bumps the nonce', async () => {
      const { finalize } = build([]);
      const row = address({ unsweptAmount: toCrypto('100') });
      const manager = managerWith(row);

      await finalize(manager, {
        idempotencyKey: 'sweep:3:2:usdt',
        kind: OutgoingTransferKind.Usdt,
        status: OutgoingTransferStatus.Confirmed,
        amountSun: '120500000',
      });

      expect(row.unsweptAmount.toFixed(6)).toBe('0.000000');
      expect(row.lastSweptAt).toBeInstanceOf(Date);
      expect(row.sweepNonce).toBe(3);
      expect(manager.save).toHaveBeenCalledWith(row);
    });

    it('keeps the part that arrived after the sweep', async () => {
      const { finalize } = build([]);
      const row = address({ unsweptAmount: toCrypto('150') });

      await finalize(managerWith(row), {
        idempotencyKey: 'sweep:3:2:usdt',
        kind: OutgoingTransferKind.Usdt,
        status: OutgoingTransferStatus.Confirmed,
        amountSun: '120000000',
      });

      expect(row.unsweptAmount.toFixed(6)).toBe('30.000000');
    });

    it('records an activation', async () => {
      const { finalize } = build([]);
      const row = address({ activatedAt: null });

      await finalize(managerWith(row), {
        idempotencyKey: 'sweep:3:2:activate',
        kind: OutgoingTransferKind.Trx,
        status: OutgoingTransferStatus.Confirmed,
        amountSun: '1',
      });

      expect(row.activatedAt).toBeInstanceOf(Date);
    });

    it('forgets the delegation after an undelegation and after a failed delegation', async () => {
      const { finalize } = build([]);
      const undelegated = address({ sweepDelegatedSun: '13000000000' });
      const refused = address({ sweepDelegatedSun: '13000000000' });

      await finalize(managerWith(undelegated), {
        idempotencyKey: 'sweep:3:2:undelegate',
        kind: OutgoingTransferKind.Undelegate,
        status: OutgoingTransferStatus.Confirmed,
        amountSun: '13000000000',
      });
      await finalize(managerWith(refused), {
        idempotencyKey: 'sweep:3:2:delegate',
        kind: OutgoingTransferKind.Delegate,
        status: OutgoingTransferStatus.Failed,
        amountSun: '13000000000',
      });

      expect(undelegated.sweepDelegatedSun).toBeNull();
      expect(refused.sweepDelegatedSun).toBeNull();
    });

    it('keeps the unswept amount after a failed USDT step but bumps the nonce for a fresh key', async () => {
      const { finalize } = build([]);
      const row = address({ unsweptAmount: toCrypto('120') });

      await finalize(managerWith(row), {
        idempotencyKey: 'sweep:3:2:usdt',
        kind: OutgoingTransferKind.Usdt,
        status: OutgoingTransferStatus.Expired,
        amountSun: '120000000',
      });

      expect(row.unsweptAmount.toFixed(6)).toBe('120.000000');
      expect(row.sweepNonce).toBe(3);
    });

    it('does nothing for an address that no longer exists', async () => {
      const { finalize } = build([]);
      const manager = managerWith(null);

      await finalize(manager, {
        idempotencyKey: 'sweep:9:0:usdt',
        kind: OutgoingTransferKind.Usdt,
        status: OutgoingTransferStatus.Confirmed,
        amountSun: '1',
      });

      expect(manager.save).not.toHaveBeenCalled();
    });
  });
});
