import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page, toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { Invite } from '../../invites/entities/invite.entity';
import { InvitesService } from '../../invites/invites.service';
import { InviteSortField } from '../../invites/types/invite-sort-field';
import { InviteStatus } from '../../invites/types/invite-status';
import { User } from '../../users/entities/user.entity';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminInvitesController } from '../controllers/admin-invites.controller';
import { CreateInviteDto } from '../dto/create-invite.dto';
import { ListInvitesQueryDto } from '../dto/list-invites-query.dto';

const HOUR_IN_MS = 60 * 60 * 1000;

describe('AdminInvitesController', () => {
  const invites = {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    revoke: jest.fn(),
  };

  const issuer = (role: Role, id = uuidOf(1)): AuthenticatedUser => ({
    id,
    login: 'admin@example.com',
    role,
    status: UserStatus.Active,
  });

  const admin = issuer(Role.Admin);
  const superadmin = issuer(Role.Superadmin, uuidOf(2));

  const dto = (overrides: Partial<CreateInviteDto> = {}): CreateInviteDto =>
    ({
      role: Role.Trader,
      email: 'user@example.com',
      ...overrides,
    }) as CreateInviteDto;

  const account = (overrides: Partial<User> = {}): User =>
    ({
      id: uuidOf(1),
      email: 'admin@example.com',
      telegramUsername: null,
      passwordHash: 'argon2-hash',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      role: Role.Admin,
      status: UserStatus.Active,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as User;

  const invite = (overrides: Partial<Invite> = {}): Invite =>
    ({
      id: 1,
      email: 'user@example.com',
      telegramUsername: null,
      role: Role.Trader,
      code: 'ABCDEFGHJKLMNPQR',
      expiresAt: new Date(Date.now() + HOUR_IN_MS),
      usedAt: null,
      usedBy: null,
      usedByUserId: null,
      createdBy: account(),
      createdByUserId: uuidOf(1),
      createdAt: new Date(),
      ...overrides,
    }) as Invite;

  const query = (
    overrides: Partial<ListInvitesQueryDto> = {},
  ): ListInvitesQueryDto =>
    plainToInstance(ListInvitesQueryDto, { ...overrides });

  const pageOf = (rows: Invite[], total = rows.length): Page<Invite> =>
    toPage([rows, total], { page: 1, limit: 20 });

  const listedInvites = async (rows: Invite[]) => {
    invites.list.mockResolvedValue(pageOf(rows));

    return (await controller.list(query())).items;
  };

  let controller: AdminInvitesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    invites.create.mockResolvedValue(invite());

    const module = await Test.createTestingModule({
      controllers: [AdminInvitesController],
      providers: [
        { provide: InvitesService, useValue: invites },
        { provide: UserDirectoryService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();

    controller = module.get(AdminInvitesController);
  });

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminInvitesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks issuing an invite as a write', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminInvitesController.prototype.create,
      ),
    ).toBe(true);
  });

  it('leaves listing unmarked, so suspended admins can still read', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminInvitesController.prototype.list,
      ),
    ).toBeUndefined();
  });

  it('marks revoking an invite as a write', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminInvitesController.prototype.revoke,
      ),
    ).toBe(true);
  });

  describe('role issuance', () => {
    const ORDINARY_ROLES = [
      Role.Trader,
      Role.LeadTrader,
      Role.Merchant,
      Role.MerchantSupport,
      Role.MerchantAgent,
      Role.Cascade,
    ];

    it.each(ORDINARY_ROLES)('lets an admin issue %s', async (role) => {
      await expect(
        controller.create(dto({ role }), admin),
      ).resolves.toBeDefined();

      expect(invites.create).toHaveBeenCalledWith(
        expect.objectContaining({ role }),
      );
    });

    it.each([Role.Admin, Role.Superadmin])(
      'refuses an admin issuing %s',
      async (role) => {
        await expect(controller.create(dto({ role }), admin)).rejects.toThrow(
          ForbiddenException,
        );

        expect(invites.create).not.toHaveBeenCalled();
      },
    );

    it.each(Object.values(Role))('lets a superadmin issue %s', async (role) => {
      await expect(
        controller.create(dto({ role }), superadmin),
      ).resolves.toBeDefined();

      expect(invites.create).toHaveBeenCalledWith(
        expect.objectContaining({ role }),
      );
    });
  });

  describe('the identifier handed to the service', () => {
    it('carries the email alone when only an email was given', async () => {
      await controller.create(
        dto({ email: 'user@example.com', telegramUsername: undefined }),
        admin,
      );

      expect(invites.create).toHaveBeenCalledWith({
        identifier: { email: 'user@example.com' },
        role: Role.Trader,
        createdByUserId: uuidOf(1),
      });
    });

    it('carries the telegram username alone when only that was given', async () => {
      await controller.create(
        dto({ email: undefined, telegramUsername: '@durov' }),
        admin,
      );

      expect(invites.create).toHaveBeenCalledWith({
        identifier: { telegramUsername: '@durov' },
        role: Role.Trader,
        createdByUserId: uuidOf(1),
      });
    });

    it('passes both through so the service can reject the pair', async () => {
      await controller.create(
        dto({ email: 'user@example.com', telegramUsername: '@durov' }),
        admin,
      );

      expect(invites.create).toHaveBeenCalledWith({
        identifier: {
          email: 'user@example.com',
          telegramUsername: '@durov',
        },
        role: Role.Trader,
        createdByUserId: uuidOf(1),
      });
    });

    it('passes neither through so the service can reject the absence', async () => {
      await controller.create(
        dto({ email: undefined, telegramUsername: undefined }),
        admin,
      );

      expect(invites.create).toHaveBeenCalledWith({
        identifier: {},
        role: Role.Trader,
        createdByUserId: uuidOf(1),
      });
    });
  });

  it('records which admin issued the invite', async () => {
    const created = await controller.create(dto(), admin);

    expect(invites.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdByUserId: uuidOf(1) }),
    );
    expect(created.code).toBe('ABCDEFGHJKLMNPQR');
    expect(created.status).toBe(InviteStatus.Pending);
  });

  it('hands the whole query to the module that owns the data', async () => {
    invites.list.mockResolvedValue(pageOf([invite()]));

    const asked = query({
      page: 3,
      limit: 5,
      search: 'ABCD',
      role: Role.Trader,
      status: InviteStatus.Expired,
      sortBy: InviteSortField.ExpiresAt,
      sortOrder: SortOrder.Asc,
    });

    await controller.list(asked);

    expect(invites.list).toHaveBeenCalledWith(asked);
  });

  it('keeps the counters beside the mapped rows', async () => {
    invites.list.mockResolvedValue(
      toPage([[invite()], 41], { page: 2, limit: 20 }),
    );

    const page = await controller.list(query({ page: 2 }));

    expect(page.items).toHaveLength(1);
    expect(page.meta).toEqual({ total: 41, page: 2, limit: 20, pages: 3 });
  });

  it('lists every code with its current status and role', async () => {
    const listed = await listedInvites([
      invite(),
      invite({
        id: 2,
        usedAt: new Date(),
        usedBy: account({
          id: uuidOf(7),
          email: 'user@example.com',
          role: Role.Trader,
        }),
        usedByUserId: uuidOf(7),
      }),
      invite({
        id: 3,
        role: Role.Merchant,
        email: null,
        telegramUsername: '@durov',
        expiresAt: new Date(Date.now() - HOUR_IN_MS),
      }),
    ]);

    expect(listed.map((entry) => entry.status)).toEqual([
      InviteStatus.Pending,
      InviteStatus.Used,
      InviteStatus.Expired,
    ]);
    expect(listed.map((entry) => entry.role)).toEqual([
      Role.Trader,
      Role.Trader,
      Role.Merchant,
    ]);
    expect(listed[2].telegramUsername).toBe('@durov');
    expect(listed.every((entry) => Boolean(entry.code))).toBe(true);
  });

  describe('the accounts behind an invite', () => {
    it('names both the issuer and the redeemer', async () => {
      const [listed] = await listedInvites([
        invite({
          createdBy: account({ id: uuidOf(3), email: 'boss@example.com' }),
          createdByUserId: uuidOf(3),
          usedAt: new Date(),
          usedBy: account({
            id: uuidOf(7),
            email: 'user@example.com',
            role: Role.Trader,
          }),
          usedByUserId: uuidOf(7),
        }),
      ]);

      expect(listed.createdBy).toEqual({
        id: uuidOf(3),
        login: 'boss@example.com',
        role: Role.Admin,
      });
      expect(listed.usedBy).toEqual({
        id: uuidOf(7),
        login: 'user@example.com',
        role: Role.Trader,
      });
    });

    it('reports usedBy as null while the invite is unused', async () => {
      const [listed] = await listedInvites([invite()]);

      expect(listed.usedBy).toBeNull();
      expect(listed.status).toBe(InviteStatus.Pending);
    });

    it('falls back to the telegram username as the login', async () => {
      const [listed] = await listedInvites([
        invite({
          createdBy: account({
            id: uuidOf(4),
            email: null,
            telegramUsername: 'durov',
          }),
          createdByUserId: uuidOf(4),
        }),
      ]);

      expect(listed.createdBy.login).toBe('durov');
    });

    it('carries nothing beyond the id, login and role', async () => {
      const [listed] = await listedInvites([
        invite({
          usedAt: new Date(),
          usedBy: account({ id: uuidOf(7), role: Role.Trader }),
          usedByUserId: uuidOf(7),
        }),
      ]);

      for (const person of [listed.createdBy, listed.usedBy]) {
        expect(Object.keys(person).sort()).toEqual(['id', 'login', 'role']);
        expect(person).not.toHaveProperty('passwordHash');
        expect(person).not.toHaveProperty('totpSecret');
        expect(person).not.toHaveProperty('status');
        expect(person).not.toHaveProperty('email');
        expect(person).not.toHaveProperty('telegramUsername');
      }
    });

    it('drops the bare identifiers the nested accounts replace', async () => {
      const [listed] = await listedInvites([invite()]);

      expect(listed).not.toHaveProperty('createdByUserId');
      expect(listed).not.toHaveProperty('usedByUserId');
    });

    it('names the issuer on the freshly created invite too', async () => {
      invites.create.mockResolvedValue(
        invite({
          createdBy: account({ id: uuidOf(3), email: 'boss@example.com' }),
          createdByUserId: uuidOf(3),
        }),
      );

      const created = await controller.create(dto(), admin);

      expect(created.createdBy).toEqual({
        id: uuidOf(3),
        login: 'boss@example.com',
        role: Role.Admin,
      });
      expect(created.usedBy).toBeNull();
    });
  });

  describe('the expiry an admin may choose', () => {
    it('passes the given moment through to the service', async () => {
      const expiresAt = new Date(Date.now() + 5 * HOUR_IN_MS);

      await controller.create(dto({ expiresAt }), admin);

      expect(invites.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt }),
      );
    });

    it('leaves the lifetime to the service when none was given', async () => {
      await controller.create(dto(), admin);

      expect(invites.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: undefined }),
      );
    });
  });

  describe('revoke', () => {
    it('hands the invite and the caller to the service', async () => {
      invites.findById.mockResolvedValue(invite());
      invites.revoke.mockResolvedValue(
        invite({ revokedAt: new Date(), revokedBy: account() }),
      );

      const revoked = await controller.revoke(1, admin);

      expect(invites.revoke).toHaveBeenCalledWith(1, uuidOf(1));
      expect(revoked.status).toBe(InviteStatus.Revoked);
      expect(revoked.revokedBy).toEqual({
        id: uuidOf(1),
        login: 'admin@example.com',
        role: Role.Admin,
      });
    });

    it('answers not found before it asks the service to revoke', async () => {
      invites.findById.mockResolvedValue(null);

      await expect(controller.revoke(1, admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(invites.revoke).not.toHaveBeenCalled();
    });

    it.each([Role.Admin, Role.Superadmin])(
      'refuses an admin revoking a %s invite',
      async (role) => {
        invites.findById.mockResolvedValue(invite({ role }));

        await expect(controller.revoke(1, admin)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(invites.revoke).not.toHaveBeenCalled();
      },
    );

    it.each(Object.values(Role))(
      'lets a superadmin revoke a %s invite',
      async (role) => {
        invites.findById.mockResolvedValue(invite({ role }));
        invites.revoke.mockResolvedValue(
          invite({ role, revokedAt: new Date(), revokedBy: account() }),
        );

        await expect(controller.revoke(1, superadmin)).resolves.toBeDefined();
        expect(invites.revoke).toHaveBeenCalledWith(1, uuidOf(2));
      },
    );
  });
});
