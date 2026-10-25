import { Logger } from '@nestjs/common';
import { DebtAutoWriteOffService } from '../services/debt-auto-write-off.service';

describe('DebtAutoWriteOffService', () => {
  const NOW = new Date('2026-10-25T00:00:00Z');

  const build = () => {
    const debts = {
      findDueIds: jest.fn(async () => [] as number[]),
      autoWriteOff: jest.fn(async () => true),
    };
    const config = { get: jest.fn(() => 60) };
    const service = new DebtAutoWriteOffService(
      debts as never,
      config as never,
    );

    return { debts, config, service };
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('starts an unref’d timer on the configured interval and clears it on shutdown', () => {
    jest.useFakeTimers();
    const { service, config, debts } = build();

    service.onModuleInit();

    expect(config.get).toHaveBeenCalledWith(
      'DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS',
    );
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(60_000);
    expect(debts.findDueIds).toHaveBeenCalledTimes(1);

    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('writes off every due debt, each on its own', async () => {
    const { service, debts } = build();
    debts.findDueIds.mockResolvedValue([3, 8]);

    await expect(service.run(NOW)).resolves.toBe(2);
    expect(debts.findDueIds).toHaveBeenCalledWith(NOW, 100);
    expect(debts.autoWriteOff).toHaveBeenNthCalledWith(1, 3, NOW);
    expect(debts.autoWriteOff).toHaveBeenNthCalledWith(2, 8, NOW);
  });

  it('does not count a debt that another instance took or that stopped being due', async () => {
    const { service, debts } = build();
    debts.findDueIds.mockResolvedValue([3, 8]);
    debts.autoWriteOff.mockResolvedValueOnce(false);

    await expect(service.run(NOW)).resolves.toBe(1);
  });

  it('carries on past a debt whose write-off fails', async () => {
    const { service, debts } = build();
    debts.findDueIds.mockResolvedValue([3, 8]);
    debts.autoWriteOff.mockRejectedValueOnce(new Error('wallet gone'));

    await expect(service.run(NOW)).resolves.toBe(1);
    expect(debts.autoWriteOff).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('logs and survives a failed lookup', async () => {
    const { service, debts } = build();
    debts.findDueIds.mockRejectedValue(new Error('db down'));

    await expect(service.run(NOW)).resolves.toBe(0);
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('does not start a second run while one is in progress', async () => {
    const { service, debts } = build();
    let release: (ids: number[]) => void = () => undefined;
    debts.findDueIds.mockReturnValueOnce(
      new Promise<number[]>((resolve) => (release = resolve)),
    );

    const first = service.run(NOW);
    await expect(service.run(NOW)).resolves.toBe(0);
    release([]);
    await first;

    expect(debts.findDueIds).toHaveBeenCalledTimes(1);
  });
});
