import { Logger } from '@nestjs/common';
import { DepositExpiryService } from '../services/deposit-expiry.service';

const NOW = new Date('2026-10-25T12:00:00.000Z');

const build = () => {
  const deposits = { expire: jest.fn(async () => 0) };
  const config = { get: jest.fn((_key: string, fallback: number) => fallback) };
  const service = new DepositExpiryService(config as never, deposits as never);

  return { service, deposits, config };
};

describe('DepositExpiryService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('expires batch after batch until a batch comes back short', async () => {
    const { service, deposits } = build();
    deposits.expire
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(7);

    await expect(service.tick(NOW)).resolves.toBe(207);

    expect(deposits.expire).toHaveBeenCalledTimes(3);
    expect(deposits.expire).toHaveBeenCalledWith(NOW, 100);
  });

  it('does not start a run while one is in progress', async () => {
    const { service, deposits } = build();
    let finish: (value: number) => void = () => undefined;
    deposits.expire.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );

    const first = service.tick(NOW);
    await expect(service.tick(NOW)).resolves.toBe(0);
    finish(3);

    await expect(first).resolves.toBe(3);
    expect(deposits.expire).toHaveBeenCalledTimes(1);
  });

  it('logs a failure and answers 0, ready for the next run', async () => {
    const { service, deposits } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    deposits.expire.mockRejectedValueOnce(new Error('db down'));

    await expect(service.tick(NOW)).resolves.toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'));

    deposits.expire.mockResolvedValueOnce(2);
    await expect(service.tick(NOW)).resolves.toBe(2);
  });

  it('starts an unref’d timer on the configured interval and clears it', () => {
    const { service, config } = build();
    const unref = jest.fn();
    const interval = jest
      .spyOn(global, 'setInterval')
      .mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    const clear = jest.spyOn(global, 'clearInterval').mockImplementation();

    service.onModuleInit();
    service.onModuleDestroy();

    expect(config.get).toHaveBeenCalledWith(
      'DEPOSIT_EXPIRY_INTERVAL_SECONDS',
      30,
    );
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(unref).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });
});
