import { LessThan } from 'typeorm';
import { SelectionAttemptRetentionService } from '../services/selection-attempt-retention.service';

describe('SelectionAttemptRetentionService', () => {
  const build = () => {
    const attempts = { delete: jest.fn(async () => ({ affected: 4 })) };
    const config = { getOrThrow: jest.fn(() => 30) };

    return {
      attempts,
      config,
      service: new SelectionAttemptRetentionService(
        attempts as never,
        config as never,
      ),
    };
  };

  it('deletes the attempts older than SELECTION_ATTEMPTS_RETENTION_DAYS', async () => {
    const { service, attempts, config } = build();

    await expect(service.run(new Date('2026-11-04T00:00:00Z'))).resolves.toBe(
      4,
    );
    expect(config.getOrThrow).toHaveBeenCalledWith(
      'SELECTION_ATTEMPTS_RETENTION_DAYS',
    );
    expect(attempts.delete).toHaveBeenCalledWith({
      createdAt: LessThan(new Date('2026-10-05T00:00:00Z')),
    });
  });

  it('logs a failure and answers zero instead of throwing', async () => {
    const { service, attempts } = build();
    attempts.delete.mockRejectedValueOnce(new Error('db down'));
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
    const { service, attempts } = build();

    service.onModuleInit();
    jest.advanceTimersByTime(60 * 60 * 1000);
    service.onModuleDestroy();
    jest.advanceTimersByTime(60 * 60 * 1000);
    jest.useRealTimers();

    expect(attempts.delete).toHaveBeenCalledTimes(1);
  });
});
