import { getMetadataArgsStorage } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuditInstallation } from '../entities/audit-installation.entity';
import { AuditInstallationService } from '../services/audit-installation.service';

describe('AuditInstallationService', () => {
  let insert: Record<string, jest.Mock>;
  let repo: { createQueryBuilder: jest.Mock; findOneByOrFail: jest.Mock };
  let service: AuditInstallationService;

  beforeEach(() => {
    insert = {};
    for (const method of ['insert', 'into', 'values', 'orIgnore']) {
      insert[method] = jest.fn(() => insert);
    }
    insert.execute = jest.fn(async () => ({}));
    repo = {
      createQueryBuilder: jest.fn(() => insert),
      findOneByOrFail: jest.fn(async () => ({ installationId: uuidOf(1) })),
    };
    service = new AuditInstallationService(repo as never);
  });

  it('inserts the single row with ON CONFLICT DO NOTHING and reads it back', async () => {
    await expect(service.installationId()).resolves.toBe(uuidOf(1));

    expect(insert.into).toHaveBeenCalledWith(AuditInstallation);
    expect(insert.values).toHaveBeenCalledWith({ singleton: true });
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(repo.findOneByOrFail).toHaveBeenCalledWith({ singleton: true });
  });

  it('asks the database once, however many callers race for the id', async () => {
    const ids = await Promise.all([
      service.installationId(),
      service.installationId(),
      service.installationId(),
    ]);
    await service.installationId();

    expect(ids).toEqual([uuidOf(1), uuidOf(1), uuidOf(1)]);
    expect(insert.execute).toHaveBeenCalledTimes(1);
    expect(repo.findOneByOrFail).toHaveBeenCalledTimes(1);
  });

  it('reads the row another instance inserted first, since its own insert was ignored', async () => {
    insert.execute.mockResolvedValueOnce({ identifiers: [], raw: [] });
    repo.findOneByOrFail.mockResolvedValueOnce({ installationId: uuidOf(2) });

    await expect(service.installationId()).resolves.toBe(uuidOf(2));
  });

  it('does not cache a failure, so the next caller tries again', async () => {
    insert.execute.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.installationId()).rejects.toThrow('connection lost');
    await expect(service.installationId()).resolves.toBe(uuidOf(1));
    expect(insert.execute).toHaveBeenCalledTimes(2);
  });

  it('lets the database generate the id and keeps both keys unique', () => {
    const storage = getMetadataArgsStorage();
    const generated = storage.generations.find(
      (g) =>
        g.target === AuditInstallation && g.propertyName === 'installationId',
    );
    const uniques = storage.indices
      .filter((index) => index.target === AuditInstallation && index.unique)
      .map((index) => index.columns);
    const updatedAt = storage.columns.find(
      (column) =>
        column.target === AuditInstallation &&
        column.propertyName === 'updatedAt',
    );

    expect(generated?.strategy).toBe('uuid');
    expect(uniques).toEqual(
      expect.arrayContaining([['singleton'], ['installationId']]),
    );
    expect(updatedAt?.mode).toBe('updateDate');
  });
});
