import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ACTIVITY_ACTIONS } from '../../audit/types/activity-action.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditSortField } from '../../audit/types/audit-sort-field.enum';
import { AuditSource } from '../../audit/types/audit-source.enum';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AdminAuditController } from '../controllers/admin-audit.controller';
import { ListAllAuditQueryDto } from '../dto/list-all-audit-query.dto';
import { ListAuditQueryDto } from '../dto/list-audit-query.dto';

const row = {
  id: 5,
  source: AuditSource.Http,
  actorUserId: null,
  impersonatorUserId: uuidOf(5),
  targetUserId: null,
  action: 'POST /auth/login',
  reason: null,
  metadata: null,
  method: 'POST',
  path: '/auth/login',
  params: null,
  statusCode: 401,
  ip: '127.0.0.1',
  userAgent: 'probe',
  login: 'who@example.com',
  body: { login: 'who@example.com', password: '[REDACTED]' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  archivedAt: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('AdminAuditController', () => {
  let audit: { list: jest.Mock };
  let directory: { findById: jest.Mock; findByIds: jest.Mock };
  let controller: AdminAuditController;

  beforeEach(() => {
    audit = {
      list: jest.fn(
        async () => new Page([row], { total: 1, page: 1, limit: 20, pages: 1 }),
      ),
    };
    directory = {
      findById: jest.fn(async () => ({ id: uuidOf(1) })),
      findByIds: jest.fn(async () => []),
    };
    controller = new AdminAuditController(audit as never, directory as never);
  });

  it('is admin-only, behind the same guards as every admin controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminAuditController)).toEqual([
      RolesGuard,
      WriteAccessGuard,
    ]);
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminAuditController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  describe('GET /admin/audit', () => {
    it('passes every filter through and returns the rows without archive bookkeeping', async () => {
      const query = Object.assign(new ListAllAuditQueryDto(), {
        page: 2,
        limit: 10,
        sortBy: AuditSortField.Id,
        sortOrder: SortOrder.Asc,
        targetUserId: uuidOf(1),
        actorUserId: uuidOf(2),
        impersonatorUserId: uuidOf(5),
        action: 'POST /auth/login',
        source: AuditSource.Http,
        statusCode: 401,
      });

      const page = await controller.listAll(query);

      expect(audit.list).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        sortBy: AuditSortField.Id,
        sortOrder: SortOrder.Asc,
        targetUserId: uuidOf(1),
        actorUserId: uuidOf(2),
        impersonatorUserId: uuidOf(5),
        action: 'POST /auth/login',
        source: AuditSource.Http,
        statusCode: 401,
      });
      expect(page.items[0]).toEqual({
        id: 5,
        source: AuditSource.Http,
        actorUserId: null,
        impersonatorUserId: uuidOf(5),
        targetUserId: null,
        action: 'POST /auth/login',
        reason: null,
        metadata: null,
        method: 'POST',
        path: '/auth/login',
        params: null,
        statusCode: 401,
        ip: '127.0.0.1',
        userAgent: 'probe',
        login: 'who@example.com',
        body: { login: 'who@example.com', password: '[REDACTED]' },
        createdAt: row.createdAt,
      });
      expect(page.meta.total).toBe(1);
    });
  });

  describe('GET /admin/users/:id/audit', () => {
    it('goes through the same reader with the target fixed to the account', async () => {
      await controller.list(uuidOf(1), new ListAuditQueryDto());

      expect(audit.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        sortBy: AuditSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
        targetUserId: uuidOf(1),
      });
    });

    it('is a 404 for an account that does not exist', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(
        controller.list(uuidOf(1), new ListAuditQueryDto()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.list).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/users/:id/activity', () => {
    const activityRow = (id: number, actorUserId: string | null) => ({
      ...row,
      id,
      source: AuditSource.Domain,
      actorUserId,
      impersonatorUserId: null,
      targetUserId: uuidOf(1),
      action: 'activity.device_added',
      metadata: { id: 7, name: 'Pixel' },
    });

    it('reads only the catalog actions of the account, newest first', async () => {
      await controller.activity(uuidOf(1), new PaginationQueryDto());

      expect(audit.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        sortBy: AuditSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
        targetUserId: uuidOf(1),
        actions: ACTIVITY_ACTIONS,
      });
    });

    it('resolves every actor login in one batched lookup, de-duplicated', async () => {
      audit.list.mockResolvedValue(
        new Page(
          [
            activityRow(3, uuidOf(2)),
            activityRow(2, uuidOf(2)),
            activityRow(1, uuidOf(1)),
          ],
          { total: 3, page: 1, limit: 20, pages: 1 },
        ),
      );
      directory.findByIds.mockResolvedValue([
        { id: uuidOf(1), email: 'trader@example.com', telegramUsername: null },
        { id: uuidOf(2), email: null, telegramUsername: 'admin_tg' },
      ]);

      const page = await controller.activity(
        uuidOf(1),
        new PaginationQueryDto(),
      );

      expect(directory.findByIds).toHaveBeenCalledTimes(1);
      expect(directory.findByIds).toHaveBeenCalledWith([uuidOf(2), uuidOf(1)]);
      expect(page.items).toEqual([
        {
          id: 3,
          action: 'activity.device_added',
          actor: { id: uuidOf(2), login: 'admin_tg' },
          impersonator: null,
          metadata: { id: 7, name: 'Pixel' },
          createdAt: row.createdAt,
        },
        expect.objectContaining({
          id: 2,
          actor: { id: uuidOf(2), login: 'admin_tg' },
        }),
        expect.objectContaining({
          id: 1,
          actor: { id: uuidOf(1), login: 'trader@example.com' },
        }),
      ]);
      expect(page.meta.total).toBe(3);
    });

    it('names the superadmin of a login-link session, resolved in the same lookup as the actors', async () => {
      audit.list.mockResolvedValue(
        new Page(
          [
            { ...activityRow(2, uuidOf(1)), impersonatorUserId: uuidOf(5) },
            activityRow(1, uuidOf(1)),
          ],
          { total: 2, page: 1, limit: 20, pages: 1 },
        ),
      );
      directory.findByIds.mockResolvedValue([
        { id: uuidOf(1), email: 'trader@example.com', telegramUsername: null },
        { id: uuidOf(5), email: 'root@example.com', telegramUsername: null },
      ]);

      const page = await controller.activity(
        uuidOf(1),
        new PaginationQueryDto(),
      );

      expect(directory.findByIds).toHaveBeenCalledTimes(1);
      expect(directory.findByIds).toHaveBeenCalledWith([uuidOf(1), uuidOf(5)]);
      expect(page.items.map((item) => [item.actor, item.impersonator])).toEqual(
        [
          [
            { id: uuidOf(1), login: 'trader@example.com' },
            { id: uuidOf(5), login: 'root@example.com' },
          ],
          [{ id: uuidOf(1), login: 'trader@example.com' }, null],
        ],
      );
    });

    it('shows the system as a null actor', async () => {
      audit.list.mockResolvedValue(
        new Page([activityRow(1, null)], {
          total: 1,
          page: 1,
          limit: 20,
          pages: 1,
        }),
      );

      const page = await controller.activity(
        uuidOf(1),
        new PaginationQueryDto(),
      );

      expect(page.items[0].actor).toBeNull();
      expect(directory.findByIds).toHaveBeenCalledWith([]);
    });

    it('is a 404 for an account that does not exist', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(
        controller.activity(uuidOf(1), new PaginationQueryDto()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.list).not.toHaveBeenCalled();
    });

    it('is read-only: no handler on the controller is a write', () => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminAuditController.prototype.activity,
        ),
      ).toBeUndefined();
    });
  });
});
