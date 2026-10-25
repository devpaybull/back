import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminBankDetailsController } from '../../admin/controllers/admin-bank-details.controller';
import { AdminDevicesController } from '../../admin/controllers/admin-devices.controller';
import { BankDetailsController } from '../../bank-details/bank-details.controller';
import { ROLES_METADATA_KEY } from '../decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../decorators/write-access.decorator';
import { DevicesController } from '../../devices/devices.controller';
import { Role } from '../enums/role.enum';
import { RolesGuard } from '../guards/roles.guard';
import { WriteAccessGuard } from '../guards/write-access.guard';

describe('deleting and switching are reachable by the owner or an admin, and by nobody else', () => {
  const ownerControllers = [BankDetailsController, DevicesController];
  const adminControllers = [AdminBankDetailsController, AdminDevicesController];
  const everyController = [...ownerControllers, ...adminControllers];

  const guardsOn = (controller: object): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];

  const rolesOn = (controller: object): Role[] =>
    Reflect.getMetadata(ROLES_METADATA_KEY, controller) ?? [];

  it.each(everyController.map((c) => [c.name, c] as const))(
    '%s carries both guards, so the roles it declares are enforced',
    (_name, controller) => {
      expect(guardsOn(controller)).toEqual([RolesGuard, WriteAccessGuard]);
    },
  );

  it.each(everyController.map((c) => [c.name, c] as const))(
    '%s declares its roles, without which RolesGuard lets everything through',
    (_name, controller) => {
      expect(rolesOn(controller).length).toBeGreaterThan(0);
    },
  );

  it.each(ownerControllers.map((c) => [c.name, c] as const))(
    '%s is the owner path: traders only',
    (_name, controller) => {
      expect(rolesOn(controller)).toEqual([Role.Trader]);
    },
  );

  it.each(adminControllers.map((c) => [c.name, c] as const))(
    '%s is the admin path: admins and superadmins only',
    (_name, controller) => {
      expect(rolesOn(controller)).toEqual([Role.Admin, Role.Superadmin]);
    },
  );

  it('leaves no third party a route: every role outside these two sets is refused', () => {
    const reachable = new Set(everyController.flatMap(rolesOn));

    expect([...reachable].sort()).toEqual(
      [Role.Admin, Role.Superadmin, Role.Trader].sort(),
    );

    const shutOut = Object.values(Role).filter((role) => !reachable.has(role));

    expect(shutOut).toEqual([
      Role.LeadTrader,
      Role.Merchant,
      Role.MerchantSupport,
      Role.MerchantAgent,
      Role.Cascade,
    ]);
  });

  it.each([
    [BankDetailsController, ['remove', 'enable', 'disable']],
    [DevicesController, ['remove']],
    [AdminBankDetailsController, ['remove', 'enable', 'disable']],
    [AdminDevicesController, ['remove']],
  ] as const)(
    'every deleting and switching handler on $0.name is marked @WriteAccess()',
    (controller, handlers) => {
      for (const handler of handlers) {
        expect(
          Reflect.getMetadata(
            WRITE_ACCESS_METADATA_KEY,
            controller.prototype[handler],
          ),
        ).toBe(true);
      }
    },
  );
});
