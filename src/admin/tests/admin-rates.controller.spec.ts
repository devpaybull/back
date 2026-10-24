import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { RateScope } from '../../transactions/types/rate-scope.enum';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminRatesController } from '../controllers/admin-rates.controller';

describe('AdminRatesController', () => {
  const admin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'admin@example.com',
    role: Role.Admin,
    status: UserStatus.Active,
  };

  let rates: {
    getBaseSet: jest.Mock;
    replaceBaseSet: jest.Mock;
    getSubjectSet: jest.Mock;
    replaceSubjectSet: jest.Mock;
  };
  let directory: { findById: jest.Mock };
  let controller: AdminRatesController;

  beforeEach(() => {
    rates = {
      getBaseSet: jest.fn(async () => []),
      replaceBaseSet: jest.fn(async () => []),
      getSubjectSet: jest.fn(async () => []),
      replaceSubjectSet: jest.fn(async () => []),
    };
    directory = { findById: jest.fn() };
    controller = new AdminRatesController(rates as never, directory as never);
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminRatesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks the two replacements as writes and leaves reads unmarked', () => {
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.replaceBase),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.replaceSubject),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.readBase),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.readSubject),
    ).toBeUndefined();
  });

  describe('base rates', () => {
    it('replaces with the acting admin as actor', async () => {
      await controller.replaceBase(RateScope.Trader, { methods: [] }, admin);

      expect(rates.replaceBaseSet).toHaveBeenCalledWith(RateScope.Trader, [], {
        actorUserId: admin.id,
      });
    });
  });

  describe('individual rates', () => {
    it('404 when the user is unknown', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(controller.readSubject(uuidOf(1))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('400 when the user is neither trader nor lead trader', async () => {
      directory.findById.mockResolvedValue({ role: Role.Merchant } as User);

      await expect(controller.readSubject(uuidOf(1))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('resolves the lead scope from a lead trader', async () => {
      directory.findById.mockResolvedValue({ role: Role.LeadTrader } as User);

      await controller.readSubject(uuidOf(1));

      expect(rates.getSubjectSet).toHaveBeenCalledWith(
        RateScope.Lead,
        uuidOf(1),
      );
    });

    it('403 on self-edit', async () => {
      await expect(
        controller.replaceSubject(admin.id, { methods: [] }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('403 when the target outranks the admin', async () => {
      directory.findById.mockResolvedValue({ role: Role.Superadmin } as User);

      await expect(
        controller.replaceSubject(uuidOf(1), { methods: [] }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('replaces the trader set with the acting admin as actor', async () => {
      directory.findById.mockResolvedValue({ role: Role.Trader } as User);

      await controller.replaceSubject(uuidOf(1), { methods: [] }, admin);

      expect(rates.replaceSubjectSet).toHaveBeenCalledWith(
        RateScope.Trader,
        uuidOf(1),
        [],
        { actorUserId: admin.id },
      );
    });
  });
});
