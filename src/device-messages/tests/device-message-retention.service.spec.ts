import { LessThan } from 'typeorm';
import { DeviceMessageRetentionService } from '../services/device-message-retention.service';

describe('DeviceMessageRetentionService', () => {
  const build = () => {
    const messages = { delete: jest.fn(async () => ({ affected: 4 })) };
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

  it('deletes the messages older than DEVICE_MESSAGE_RETENTION_DAYS', async () => {
    const { service, messages, config } = build();

    await expect(service.run(new Date('2026-11-04T00:00:00Z'))).resolves.toBe(
      4,
    );
    expect(config.getOrThrow).toHaveBeenCalledWith(
      'DEVICE_MESSAGE_RETENTION_DAYS',
    );
    expect(messages.delete).toHaveBeenCalledWith({
      createdAt: LessThan(new Date('2026-08-06T00:00:00Z')),
    });
  });

  it('logs a failure and answers zero instead of throwing', async () => {
    const { service, messages } = build();
    messages.delete.mockRejectedValueOnce(new Error('db down'));
    const logged = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation();

    await expect(service.run()).resolves.toBe(0);
    expect(logged).toHaveBeenCalled();
  });

  it('starts an unref’d timer and clears it on shutdown', () => {
    jest.useFakeTimers();
    const { service, messages } = build();

    service.onModuleInit();
    jest.advanceTimersByTime(60 * 60 * 1000);
    service.onModuleDestroy();
    jest.advanceTimersByTime(60 * 60 * 1000);
    jest.useRealTimers();

    expect(messages.delete).toHaveBeenCalledTimes(1);
  });
});
