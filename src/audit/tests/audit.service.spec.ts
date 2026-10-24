import { ServiceUnavailableException } from '@nestjs/common';
import { In } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuditService } from '../services/audit.service';
import { AuditRecord } from '../types/audit-record';
import { AuditSortField } from '../types/audit-sort-field.enum';
import { AuditSource } from '../types/audit-source.enum';
import { RecordHttpAuditEntry } from '../types/record-http-audit-entry';

const recordOf = (id: number): AuditRecord =>
  ({ id, action: `a${id}` }) as AuditRecord;

const ids = (records: AuditRecord[]): number[] => records.map((r) => r.id);

describe('AuditService', () => {
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let victoria: { enabled: boolean; find: jest.Mock };
  let lowestId: number | null;
  let service: AuditService;

  beforeEach(() => {
    lowestId = null;
    repo = {
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ id: 1, ...row })),
      findAndCount: jest.fn(async () => [[], 0]),
      count: jest.fn(async () => 0),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => ({ min: lowestId })),
      })),
    };
    victoria = { enabled: false, find: jest.fn(async () => [[], 0]) };
    service = new AuditService(repo as never, victoria as never);
  });

  describe('record', () => {
    it('defaults optional fields to null and persists via the own repository', async () => {
      const result = await service.record({
        actorUserId: uuidOf(9),
        action: 'user.transfer',
      });

      expect(repo.create).toHaveBeenCalledWith({
        actorUserId: uuidOf(9),
        impersonatorUserId: null,
        targetUserId: null,
        action: 'user.transfer',
        reason: null,
        metadata: null,
      });
      expect(result.id).toBe(1);
    });

    it('persists the superadmin of a login-link session beside the actor', async () => {
      await service.record({
        actorUserId: uuidOf(7),
        impersonatorUserId: uuidOf(5),
        targetUserId: uuidOf(7),
        action: 'activity.device_added',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: uuidOf(7),
          impersonatorUserId: uuidOf(5),
        }),
      );
    });

    it('writes through the given manager so it joins the caller transaction', async () => {
      const managerRepo = {
        create: jest.fn((row) => row),
        save: jest.fn(async (row) => ({ id: 2, ...row })),
      };
      const manager = { getRepository: jest.fn(() => managerRepo) };

      await service.record(
        {
          actorUserId: uuidOf(9),
          targetUserId: uuidOf(1),
          action: 'rates.updated',
        },
        manager as never,
      );

      expect(manager.getRepository).toHaveBeenCalled();
      expect(managerRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('recordHttp', () => {
    const entry: RecordHttpAuditEntry = {
      actorUserId: uuidOf(9),
      impersonatorUserId: uuidOf(5),
      targetUserId: uuidOf(1),
      action: 'POST /admin/users/:id/leads',
      method: 'POST',
      path: `/admin/users/${uuidOf(1)}/leads`,
      params: { id: uuidOf(1) },
      statusCode: 404,
      ip: '127.0.0.1',
      userAgent: null,
      login: null,
      body: {},
    };
    const foreignKeyViolation = Object.assign(new Error('fk'), {
      driverError: { code: '23503' },
    });

    it('stores the row as an http row', async () => {
      await service.recordHttp(entry);

      expect(repo.create).toHaveBeenCalledWith({
        ...entry,
        source: AuditSource.Http,
      });
    });

    it('drops a target that names no account rather than losing the row', async () => {
      repo.save.mockRejectedValueOnce(foreignKeyViolation);

      await service.recordHttp(entry);

      expect(repo.create).toHaveBeenLastCalledWith({
        ...entry,
        targetUserId: null,
        source: AuditSource.Http,
      });
      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('rethrows any other failure', async () => {
      repo.save.mockRejectedValueOnce(new Error('down'));

      await expect(service.recordHttp(entry)).rejects.toThrow('down');
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    const query = {
      page: 1,
      limit: 20,
      sortBy: AuditSortField.CreatedAt,
      sortOrder: SortOrder.Desc,
    };

    it('reads Postgres only when the archive is not configured', async () => {
      await service.list({ ...query, targetUserId: uuidOf(1) });

      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: { targetUserId: uuidOf(1) },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(victoria.find).not.toHaveBeenCalled();
    });

    it('applies every filter and orders by id alone when asked', async () => {
      await service.list({
        ...query,
        sortBy: AuditSortField.Id,
        sortOrder: SortOrder.Asc,
        actorUserId: uuidOf(9),
        action: 'POST /auth/login',
        source: AuditSource.Http,
        statusCode: 401,
      });

      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: {
          actorUserId: uuidOf(9),
          action: 'POST /auth/login',
          source: AuditSource.Http,
          statusCode: 401,
        },
        order: { id: 'ASC' },
        skip: 0,
        take: 20,
      });
    });

    it('filters by the superadmin who acted through a login link', async () => {
      await service.list({ ...query, impersonatorUserId: uuidOf(5) });

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { impersonatorUserId: uuidOf(5) },
        }),
      );
    });

    it('filters Postgres by a list of actions with IN', async () => {
      await service.list({ ...query, actions: ['a.one', 'a.two'] });

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: In(['a.one', 'a.two']) },
        }),
      );
    });

    it('lets an exact action win over a list of actions', async () => {
      await service.list({ ...query, action: 'a.one', actions: ['a.two'] });

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { action: 'a.one' } }),
      );
    });

    describe('with the archive configured', () => {
      beforeEach(() => {
        victoria.enabled = true;
        lowestId = 101;
      });

      it('hands the list of actions to the archive too', async () => {
        await service.list({ ...query, actions: ['a.one', 'a.two'] });

        expect(victoria.find).toHaveBeenCalledWith(
          expect.objectContaining({ actions: ['a.one', 'a.two'] }),
        );
      });

      it('asks the archive only for ids below the lowest one Postgres still holds', async () => {
        repo.findAndCount.mockResolvedValue([[recordOf(105)], 1]);

        await service.list({ ...query, statusCode: 403 });

        expect(victoria.find).toHaveBeenCalledWith(
          expect.objectContaining({ belowId: 101, statusCode: 403 }),
        );
      });

      it('hands the impersonator filter to the archive too', async () => {
        await service.list({ ...query, impersonatorUserId: uuidOf(5) });

        expect(victoria.find).toHaveBeenCalledWith(
          expect.objectContaining({ impersonatorUserId: uuidOf(5) }),
        );
      });

      it('asks the archive for everything when Postgres is empty', async () => {
        lowestId = null;

        await service.list(query);

        expect(victoria.find).toHaveBeenCalledWith(
          expect.objectContaining({ belowId: null }),
        );
      });

      it('newest first: fills a page from Postgres, then continues into the archive', async () => {
        repo.findAndCount.mockResolvedValue([
          [recordOf(102), recordOf(101)],
          2,
        ]);
        victoria.find.mockResolvedValue([[recordOf(100), recordOf(99)], 50]);

        const page = await service.list({ ...query, limit: 4 });

        expect(ids(page.items)).toEqual([102, 101, 100, 99]);
        expect(page.meta.total).toBe(52);
        expect(victoria.find).toHaveBeenCalledWith(
          expect.objectContaining({
            skip: 0,
            take: 2,
            sortOrder: SortOrder.Desc,
          }),
        );
      });

      it('newest first: a page past Postgres skips into the archive by what Postgres held', async () => {
        repo.findAndCount.mockResolvedValue([[], 3]);
        victoria.find.mockResolvedValue([[recordOf(90)], 50]);

        const page = await service.list({ ...query, page: 3, limit: 5 });

        expect(repo.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 10, take: 5 }),
        );
        expect(victoria.find).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 7, take: 5 }),
        );
        expect(ids(page.items)).toEqual([90]);
        expect(page.meta).toEqual({ total: 53, page: 3, limit: 5, pages: 11 });
      });

      it('newest first: a page Postgres fills alone only counts the archive', async () => {
        repo.findAndCount.mockResolvedValue([
          [recordOf(110), recordOf(109)],
          9,
        ]);
        victoria.find.mockResolvedValue([[], 4]);

        const page = await service.list({ ...query, limit: 2 });

        expect(victoria.find).toHaveBeenCalledWith(
          expect.objectContaining({ take: 0 }),
        );
        expect(page.meta.total).toBe(13);
      });

      it('oldest first: the archive comes first and Postgres continues it', async () => {
        victoria.find.mockResolvedValue([[recordOf(99), recordOf(100)], 2]);
        repo.findAndCount.mockResolvedValue([[recordOf(101)], 30]);

        const page = await service.list({
          ...query,
          sortOrder: SortOrder.Asc,
          limit: 3,
        });

        expect(ids(page.items)).toEqual([99, 100, 101]);
        expect(repo.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 1 }),
        );
        expect(page.meta.total).toBe(32);
      });

      it('oldest first: a page the archive fills alone only counts Postgres', async () => {
        victoria.find.mockResolvedValue([[recordOf(1), recordOf(2)], 40]);
        repo.count.mockResolvedValue(7);

        const page = await service.list({
          ...query,
          sortOrder: SortOrder.Asc,
          limit: 2,
        });

        expect(repo.findAndCount).not.toHaveBeenCalled();
        expect(repo.count).toHaveBeenCalled();
        expect(page.meta.total).toBe(47);
      });

      it('answers 503 rather than a partial list when the archive cannot be read', async () => {
        jest
          .spyOn(service['logger'], 'error')
          .mockImplementation(() => undefined);
        victoria.find.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(service.list(query)).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
      });
    });
  });
});
