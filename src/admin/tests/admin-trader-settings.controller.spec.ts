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
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminTraderSettingsController } from '../controllers/admin-trader-settings.controller';

describe('AdminTraderSettingsController', () => {
  const admin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'admin@example.com',
    role: Role.Admin,
    status: UserStatus.Active,
  };

  const target = { id: uuidOf(1), role: Role.Trader } as User;
  const settingsRow = { userId: uuidOf(1) } as TraderSettings;

  let settings: {
    ensure: jest.Mock;
    update: jest.Mock;
    insurancePayInMinOf: jest.Mock;
  };
  let directory: { findById: jest.Mock };
  let controller: AdminTraderSettingsController;

  beforeEach(() => {
    settings = {
      ensure: jest.fn(),
      update: jest.fn(),
      insurancePayInMinOf: jest.fn(() => 500),
    };
    directory = { findById: jest.fn() };
    controller = new AdminTraderSettingsController(
      settings as never,
      directory as never,
    );
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminTraderSettingsController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks only the update as a write', () => {
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.update),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.read),
    ).toBeUndefined();
  });

  describe('read', () => {
    it('404 when the user is unknown', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(controller.read(uuidOf(1))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('ensures and returns the settings', async () => {
      directory.findById.mockResolvedValue(target);
      settings.ensure.mockResolvedValue(settingsRow);

      const result = await controller.read(uuidOf(1));

      expect(settings.ensure).toHaveBeenCalledWith(uuidOf(1));
      expect(result.userId).toBe(uuidOf(1));
    });

    it('reports the personal and the effective insurance minimum', async () => {
      directory.findById.mockResolvedValue(target);
      settings.ensure.mockResolvedValue({
        ...settingsRow,
        insurancePayInMin: null,
      });

      const result = await controller.read(uuidOf(1));

      expect(result.insurancePayInMin).toBeNull();
      expect(result.effectiveInsurancePayInMin).toBe(500);
    });
  });

  describe('update', () => {
    it('400 on an empty change set', async () => {
      await expect(
        controller.update(uuidOf(1), {}, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 when auto-buyback changes without a reason', async () => {
      await expect(
        controller.update(uuidOf(1), { autoBuybackEnabled: true }, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('403 on self-edit', async () => {
      await expect(
        controller.update(admin.id, { tradingEnabled: true }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('403 when the target outranks the admin', async () => {
      directory.findById.mockResolvedValue({ role: Role.Superadmin } as User);

      await expect(
        controller.update(uuidOf(1), { tradingEnabled: true }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('treats an explicit null insurance minimum as a change', async () => {
      directory.findById.mockResolvedValue(target);
      settings.update.mockResolvedValue(settingsRow);

      await controller.update(uuidOf(1), { insurancePayInMin: null }, admin);

      expect(settings.update).toHaveBeenCalledWith(
        uuidOf(1),
        { insurancePayInMin: null },
        { actorUserId: admin.id, reason: undefined },
      );
    });

    it('updates with the acting admin and reason', async () => {
      directory.findById.mockResolvedValue(target);
      settings.update.mockResolvedValue(settingsRow);

      await controller.update(
        uuidOf(1),
        { autoBuybackEnabled: true, reason: 'ops' },
        admin,
      );

      expect(settings.update).toHaveBeenCalledWith(
        uuidOf(1),
        { autoBuybackEnabled: true },
        { actorUserId: admin.id, reason: 'ops' },
      );
    });
  });
});
