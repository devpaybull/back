import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuditService } from '../audit.service';
import { AuditSortField } from '../types/audit-sort-field.enum';

describe('AuditService', () => {
  let repo: { create: jest.Mock; save: jest.Mock; findAndCount: jest.Mock };
  let service: AuditService;

  beforeEach(() => {
    repo = {
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ id: 1, ...row })),
      findAndCount: jest.fn(async () => [[], 0]),
    };
    service = new AuditService(repo as never);
  });

  describe('record', () => {
    it('defaults optional fields to null and persists via the own repository', async () => {
      const result = await service.record({
        actorUserId: uuidOf(9),
        action: 'user.transfer',
      });

      expect(repo.create).toHaveBeenCalledWith({
        actorUserId: uuidOf(9),
        targetUserId: null,
        action: 'user.transfer',
        reason: null,
        metadata: null,
      });
      expect(result.id).toBe(1);
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

  describe('list', () => {
    it('scopes to the target user and orders newest first with an id tiebreak', async () => {
      await service.list({
        page: 1,
        limit: 20,
        sortBy: AuditSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
        targetUserId: uuidOf(1),
      });

      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: { targetUserId: uuidOf(1) },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
    });
  });
});
