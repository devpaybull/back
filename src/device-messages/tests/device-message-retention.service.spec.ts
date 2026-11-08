import { In, LessThan } from 'typeorm';
import { DeviceMessageRetentionService } from '../services/device-message-retention.service';

const idsFrom = (first: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: first + index }));

describe('DeviceMessageRetentionService', () => {
  const build = (batches: { id: number }[][] = [[{ id: 1 }, { id: 2 }]]) => {
    const messages = {
      find: jest.fn(async () => batches.shift() ?? []),
      delete: jest.fn(async (where: { id: ReturnType<typeof In> }) => ({
        affected: (where.id.value as number[]).length,
      })),
    };
    const config = { getOrThrow: jest.fn(() => 90) };

    return {
      messages,
      config,
      service: new DeviceMessageRetentionService(
        messages as never,
        config as never,
      ),
    };
  };

  it('deletes the messages older than DEVICE_MESSAGE_RETENTION_DAYS by id', async () => {
    const { service, messages, config } = build();

    await expect(service.run(new Date('2026-11-04T00:00:00Z'))).resolves.toBe(
      2,
    );
    expect(config.getOrThrow).toHaveBeenCalledWith(
      'DEVICE_MESSAGE_RETENTION_DAYS',
    );
    expect(messages.find).toHaveBeenCalledWith({
      select: { id: true },
      where: { createdAt: LessThan(new Date('2026-08-06T00:00:00Z')) },
      order: { id: 'ASC' },
      take: 1000,
    });
    expect(messages.delete).toHaveBeenCalledWith({ id: In([1, 2]) });
  });

  it('deletes in batches of 1000 until a short batch', async () => {
    const { service, messages } = build([
      idsFrom(1, 1000),
      idsFrom(1001, 1000),
      idsFrom(2001, 5),
    ]);

    await expect(service.run()).resolves.toBe(2005);
    expect(messages.delete).toHaveBeenCalledTimes(3);
  });

  it('stops after 50 batches in one run', async () => {
    const { service, messages } = build(
      Array.from({ length: 60 }, (_, index) => idsFrom(index * 1000, 1000)),
    );

    await expect(service.run()).resolves.toBe(50_000);
    expect(messages.delete).toHaveBeenCalledTimes(50);
  });

  it('logs a failure and answers what it deleted before it', async () => {
    const { service, messages } = build([idsFrom(1, 1000), idsFrom(1001, 3)]);
    messages.delete
      .mockResolvedValueOnce({ affected: 1000 })
      .mockRejectedValueOnce(new Error('db down'));
    const logged = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation();

    await expect(service.run()).resolves.toBe(1000);
    expect(logged).toHaveBeenCalled();
  });

  it('runs once a minute after boot, then every hour, and stops on shutdown', async () => {
    jest.useFakeTimers();
    const { service, messages } = build([[], [], [], []]);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(59 * 1000);
    expect(messages.find).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(messages.find).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(messages.find).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    jest.useRealTimers();

    expect(messages.find).toHaveBeenCalledTimes(2);
  });
});
