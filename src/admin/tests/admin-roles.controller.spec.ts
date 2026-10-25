import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AdminRolesController } from '../controllers/admin-roles.controller';

describe('AdminRolesController', () => {
  const controller = new AdminRolesController();

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminRolesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminRolesController)).toEqual([
      RolesGuard,
      WriteAccessGuard,
    ]);
  });

  it('leaves the listing unmarked, so suspended admins can still read', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminRolesController.prototype.list,
      ),
    ).toBeUndefined();
  });

  it('lists all eight roles as plain strings', () => {
    expect(controller.list()).toEqual([
      'trader',
      'lead_trader',
      'merchant',
      'merchant_support',
      'merchant_agent',
      'cascade',
      'admin',
      'superadmin',
    ]);
  });
});
