import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { LoginFootprintService } from '../../auth/services/login-footprint.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { AdminIdentityController } from '../controllers/admin-identity.controller';

describe('AdminIdentityController', () => {
  const footprints = { list: jest.fn() };
  const directory = { findById: jest.fn() };
  let controller: AdminIdentityController;

  const query = {
    page: 1,
    limit: 20,
    sortOrder: SortOrder.Desc,
  } as never;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [AdminIdentityController],
      providers: [
        { provide: LoginFootprintService, useValue: footprints },
        { provide: UserDirectoryService, useValue: directory },
      ],
    }).compile();

    controller = module.get(AdminIdentityController);
  });

  it('is open to admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminIdentityController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('answers 404 for an account nobody holds', async () => {
    directory.findById.mockResolvedValue(null);

    await expect(controller.list(uuidOf(9), query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(footprints.list).not.toHaveBeenCalled();
  });

  it('returns the footprints of the account as a page', async () => {
    directory.findById.mockResolvedValue({ id: uuidOf(1) });
    const seen = new Date('2026-01-01T00:00:00Z');
    footprints.list.mockResolvedValue(
      new Page(
        [
          {
            id: 5,
            ip: '203.0.113.7',
            country: 'DE',
            fingerprint: null,
            userAgent: 'agent/1.0',
            firstSeenAt: seen,
            lastSeenAt: seen,
            seenOnAccounts: 3,
          },
        ],
        { total: 1, page: 1, limit: 20, pages: 1 },
      ),
    );

    const page = await controller.list(uuidOf(1), query);

    expect(footprints.list).toHaveBeenCalledWith(uuidOf(1), query);
    expect(page.items).toEqual([
      {
        ip: '203.0.113.7',
        country: 'DE',
        fingerprint: null,
        userAgent: 'agent/1.0',
        firstSeenAt: seen,
        lastSeenAt: seen,
        seenOnAccounts: 3,
      },
    ]);
    expect(page.meta.total).toBe(1);
  });
});
