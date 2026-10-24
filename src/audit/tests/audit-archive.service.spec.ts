import { IsNull, LessThan, Not } from 'typeorm';
import { AuditArchiveService } from '../services/audit-archive.service';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as never;

describe('AuditArchiveService', () => {
  let rows: { id: number }[];
  let builder: Record<string, jest.Mock>;
  let manager: { getRepository: jest.Mock; update: jest.Mock };
  let repo: {
    manager: { transaction: jest.Mock };
    delete: jest.Mock;
  };
  let victoria: { enabled: boolean; insert: jest.Mock };
  let service: AuditArchiveService;

  beforeEach(() => {
    rows = [{ id: 1 }, { id: 2 }];
    builder = {};
    for (const method of [
      'where',
      'orderBy',
      'limit',
      'setLock',
      'setOnLocked',
    ]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getMany = jest.fn(async () => rows);
    manager = {
      getRepository: jest.fn(() => ({ createQueryBuilder: () => builder })),
      update: jest.fn(async () => ({})),
    };
    repo = {
      manager: { transaction: jest.fn(async (work) => work(manager)) },
      delete: jest.fn(async () => ({ affected: 0 })),
    };
    victoria = { enabled: true, insert: jest.fn(async () => undefined) };
    service = new AuditArchiveService(
      repo as never,
      victoria as never,
      config({
        AUDIT_ARCHIVE_BATCH_SIZE: 2,
        AUDIT_RETENTION_DAYS: 30,
        AUDIT_ARCHIVE_INTERVAL_SECONDS: 300,
      }),
    );
  });

  describe('archiveBatch', () => {
    it('locks the oldest unarchived rows, skipping ones another instance holds', async () => {
      await service.archiveBatch();

      expect(builder.where).toHaveBeenCalledWith('log.archivedAt IS NULL');
      expect(builder.orderBy).toHaveBeenCalledWith('log.id', 'ASC');
      expect(builder.limit).toHaveBeenCalledWith(2);
      expect(builder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(builder.setOnLocked).toHaveBeenCalledWith('skip_locked');
    });

    it('marks the rows archived only after VictoriaLogs accepted them', async () => {
      const archived = await service.archiveBatch();

      expect(victoria.insert).toHaveBeenCalledWith(rows);
      expect(manager.update).toHaveBeenCalledTimes(1);
      const [, where, changes] = manager.update.mock.calls[0];
      expect(where.id.value).toEqual([1, 2]);
      expect(changes.archivedAt()).toBe('now()');
      expect(archived).toBe(2);
    });

    it('marks nothing when VictoriaLogs refuses, so the transaction rolls back', async () => {
      victoria.insert.mockRejectedValue(new Error('VictoriaLogs answered 500'));

      await expect(service.archiveBatch()).rejects.toThrow(/500/);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('sends nothing when there is nothing to archive', async () => {
      rows = [];

      expect(await service.archiveBatch()).toBe(0);
      expect(victoria.insert).not.toHaveBeenCalled();
    });
  });

  describe('purgeArchived', () => {
    it('deletes only archived rows older than the retention period', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-31T00:00:00Z'));

      await service.purgeArchived();

      expect(repo.delete).toHaveBeenCalledWith({
        archivedAt: Not(IsNull()),
        createdAt: LessThan(new Date('2026-03-01T00:00:00Z')),
      });
      jest.useRealTimers();
    });
  });

  describe('run', () => {
    it('keeps archiving while batches come back full, then purges', async () => {
      const batches = jest
        .spyOn(service, 'archiveBatch')
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      const purge = jest.spyOn(service, 'purgeArchived').mockResolvedValue(0);

      await service.run();

      expect(batches).toHaveBeenCalledTimes(3);
      expect(purge).toHaveBeenCalled();
    });

    it('does not purge after a failed batch, and logs instead of throwing', async () => {
      jest.spyOn(service, 'archiveBatch').mockRejectedValue(new Error('down'));
      const purge = jest.spyOn(service, 'purgeArchived');
      const logged = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);

      await expect(service.run()).resolves.toBeUndefined();
      expect(purge).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalled();
    });

    it('does nothing when archival is disabled', async () => {
      victoria.enabled = false;
      const batches = jest.spyOn(service, 'archiveBatch');

      await service.run();
      service.onModuleInit();

      expect(batches).not.toHaveBeenCalled();
      expect(service['timer']).toBeNull();
    });

    it('starts a timer on boot when enabled and clears it on shutdown', () => {
      service.onModuleInit();
      expect(service['timer']).not.toBeNull();

      service.onModuleDestroy();
      expect(service['timer']).toBeNull();
    });
  });
});
