import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { LoginLinkService } from '../../auth/services/login-link.service';
import { PasswordService } from '../../auth/services/password.service';
import { SessionService } from '../../auth/services/session.service';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page, toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { MerchantsService } from '../../merchants/merchants.service';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { RateService } from '../../transactions/services/rate.service';
import { WalletService } from '../../transactions/services/wallet.service';
import { RateScope } from '../../transactions/types/rate-scope.enum';
import { RateSubject } from '../../transactions/types/rate-subject';
import { User } from '../../users/entities/user.entity';
import { UserAdministrationService } from '../../users/services/user-administration.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserEnrolmentService } from '../../users/services/user-enrolment.service';
import { UserTeamService } from '../../users/services/user-team.service';
import { UserSortField } from '../../users/types/user-sort-field.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminUsersController } from '../controllers/admin-users.controller';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';

describe('AdminUsersController', () => {
  const userDirectory = {
    list: jest.fn(),
    findById: jest.fn(),
  };

  const userAdministration = { update: jest.fn() };

  const userEnrolment = { resetTwoFactor: jest.fn() };

  const sessions = {
    revokeAllSessionsAudited: jest.fn(),
    revokeImpersonationSessions: jest.fn(),
    revokeImpersonatedSessions: jest.fn(),
  };

  const team = {
    addLead: jest.fn(),
    removeLead: jest.fn(),
    leadsOf: jest.fn(),
    subordinatesOf: jest.fn(),
  };

  const wallets = { findByUserIds: jest.fn() };

  const traderSettings = {
    findByUserIds: jest.fn(),
    insurancePayInMinOf: jest.fn(),
  };

  const rateService = { getEffectiveGeneralRates: jest.fn() };

  const merchants = { findByIds: jest.fn() };

  const passwords = {
    issueGeneratedPassword: jest.fn(),
    setPassword: jest.fn(),
  };

  const loginLinks = { issue: jest.fn(), invalidateIssuedBy: jest.fn() };

  const GLOBAL_MIN = 500;

  const traderBase = [{ method: 'sbp', payInPercent: 8.5, payOutPercent: 1.5 }];

  const issuer = (role: Role, id = uuidOf(1)): AuthenticatedUser => ({
    id,
    login: 'admin@example.com',
    role,
    status: UserStatus.Active,
  });

  const admin = issuer(Role.Admin);
  const superadmin = issuer(Role.Superadmin);

  const user = (overrides: Partial<User> = {}): User =>
    ({
      id: uuidOf(7),
      email: 'user@example.com',
      telegramUsername: null,
      passwordHash: '$2b$12$notarealhash',
      role: Role.Trader,
      status: UserStatus.Active,
      totpSecret: 'JBSWY3DPEHPK3PXP',
      twoFactorConfirmedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as User;

  const query = (
    overrides: Partial<ListUsersQueryDto> = {},
  ): ListUsersQueryDto => plainToInstance(ListUsersQueryDto, { ...overrides });

  const pageOf = (rows: User[], total = rows.length): Page<User> =>
    toPage([rows, total], { page: 1, limit: 20 });

  let controller: AdminUsersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    team.leadsOf.mockResolvedValue(new Map());
    team.subordinatesOf.mockResolvedValue(new Map());
    wallets.findByUserIds.mockResolvedValue([]);
    traderSettings.findByUserIds.mockResolvedValue([]);
    traderSettings.insurancePayInMinOf.mockImplementation(
      (settings?: TraderSettings | null) =>
        settings?.insurancePayInMin ?? GLOBAL_MIN,
    );
    rateService.getEffectiveGeneralRates.mockImplementation(
      async (_scope: RateScope, subjects: RateSubject[]) => ({
        base: traderBase,
        bySubject: new Map(subjects.map(({ userId }) => [userId, traderBase])),
      }),
    );
    merchants.findByIds.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        { provide: UserDirectoryService, useValue: userDirectory },
        { provide: UserAdministrationService, useValue: userAdministration },
        { provide: UserEnrolmentService, useValue: userEnrolment },
        { provide: SessionService, useValue: sessions },
        { provide: UserTeamService, useValue: team },
        { provide: WalletService, useValue: wallets },
        { provide: TraderSettingsService, useValue: traderSettings },
        { provide: RateService, useValue: rateService },
        { provide: MerchantsService, useValue: merchants },
        { provide: PasswordService, useValue: passwords },
        { provide: LoginLinkService, useValue: loginLinks },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();

    controller = module.get(AdminUsersController);
  });

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminUsersController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks the update as a write', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminUsersController.prototype.update,
      ),
    ).toBe(true);
  });

  it('leaves listing unmarked, so suspended admins can still read', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminUsersController.prototype.list,
      ),
    ).toBeUndefined();
  });

  it('leaves the single read unmarked as a write', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminUsersController.prototype.findOne,
      ),
    ).toBeUndefined();
  });

  describe('findOne', () => {
    it('answers with the list-row shape and the role details', async () => {
      userDirectory.findById.mockResolvedValue(
        user({ telegramId: '777', telegramGroups: 'a / b' }),
      );
      team.leadsOf.mockResolvedValue(
        new Map([[uuidOf(7), [{ id: uuidOf(20), login: 'lead@example.com' }]]]),
      );

      const row = await controller.findOne(uuidOf(7));

      expect(userDirectory.findById).toHaveBeenCalledWith(uuidOf(7));
      expect(row).toMatchObject({
        id: uuidOf(7),
        telegramId: '777',
        telegramGroups: 'a / b',
        leads: [{ id: uuidOf(20), login: 'lead@example.com' }],
        subordinates: null,
        merchant: null,
      });
    });

    it('agrees with the list for the same account', async () => {
      const account = user();
      userDirectory.findById.mockResolvedValue(account);
      userDirectory.list.mockResolvedValue(pageOf([account]));

      const [listed] = (await controller.list(query())).items;

      expect(await controller.findOne(uuidOf(7))).toEqual(listed);
    });

    it.each([UserStatus.Blocked, UserStatus.PendingTwoFactor])(
      'still shows a %s account',
      async (status) => {
        userDirectory.findById.mockResolvedValue(user({ status }));

        await expect(controller.findOne(uuidOf(7))).resolves.toMatchObject({
          status,
        });
      },
    );

    it('is a 404 for an unknown id', async () => {
      userDirectory.findById.mockResolvedValue(null);

      await expect(controller.findOne(uuidOf(404))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does not apply the issuing policy to a read', async () => {
      userDirectory.findById.mockResolvedValue(user({ role: Role.Superadmin }));

      await expect(controller.findOne(uuidOf(7))).resolves.toMatchObject({
        role: Role.Superadmin,
      });
    });

    it('parses the id as a uuid', () => {
      const routeArgs = Reflect.getMetadata(
        '__routeArguments__',
        AdminUsersController,
        'findOne',
      ) as Record<string, { pipes: unknown[] }>;
      const [argument] = Object.values(routeArgs);

      expect(argument.pipes).toEqual([ParseUUIDPipe]);
    });
  });

  describe('list', () => {
    it('hands the whole query to the module that owns the data', async () => {
      userDirectory.list.mockResolvedValue(pageOf([user()]));

      const asked = query({
        page: 2,
        limit: 50,
        search: 'durov',
        role: [Role.Trader],
        status: UserStatus.Active,
        sortBy: UserSortField.Email,
        sortOrder: SortOrder.Asc,
      });

      await controller.list(asked);

      expect(userDirectory.list).toHaveBeenCalledWith(asked);
    });

    it('keeps the counters beside the mapped rows', async () => {
      userDirectory.list.mockResolvedValue(
        toPage([[user()], 137], { page: 2, limit: 20 }),
      );

      const page = await controller.list(query({ page: 2 }));

      expect(page.items).toHaveLength(1);
      expect(page.meta).toEqual({ total: 137, page: 2, limit: 20, pages: 7 });
    });

    it('never exposes the password hash or the totp secret', async () => {
      userDirectory.list.mockResolvedValue(
        pageOf([user(), user({ id: uuidOf(8) })]),
      );

      const { items: listed } = await controller.list(query());

      for (const entry of listed) {
        expect(entry).not.toHaveProperty('passwordHash');
        expect(entry).not.toHaveProperty('totpSecret');
      }

      expect(JSON.stringify(listed)).not.toContain('JBSWY3DPEHPK3PXP');
      expect(JSON.stringify(listed)).not.toContain('$2b$12$notarealhash');
    });

    it('exposes exactly the agreed fields', async () => {
      userDirectory.list.mockResolvedValue(pageOf([user()]));

      const [listed] = (await controller.list(query())).items;

      expect(Object.keys(listed).sort()).toEqual([
        'balances',
        'createdAt',
        'email',
        'id',
        'insurancePayInMin',
        'leads',
        'login',
        'merchant',
        'rates',
        'role',
        'status',
        'subordinates',
        'telegramGroups',
        'telegramId',
        'telegramUsername',
      ]);
    });

    it('takes the telegram username as the login over the email', async () => {
      userDirectory.list.mockResolvedValue(
        pageOf([
          user({ email: 'durov@example.com', telegramUsername: 'durov' }),
        ]),
      );

      const [listed] = (await controller.list(query())).items;

      expect(listed.login).toBe('durov');
    });

    it('falls back to the email as the login when there is no telegram username', async () => {
      userDirectory.list.mockResolvedValue(
        pageOf([user({ email: 'user@example.com', telegramUsername: null })]),
      );

      const [listed] = (await controller.list(query())).items;

      expect(listed.login).toBe('user@example.com');
    });

    it('takes the telegram username as the login when there is no email', async () => {
      userDirectory.list.mockResolvedValue(
        pageOf([user({ email: null, telegramUsername: '@durov' })]),
      );

      const [listed] = (await controller.list(query())).items;

      expect(listed.login).toBe('@durov');
    });

    describe('the details that depend on the role', () => {
      const wallet = (overrides: Partial<Wallet> = {}): Wallet =>
        ({
          id: 1,
          userId: uuidOf(7),
          mainBalance: 1000,
          mainReserved: 250,
          insurancePayInBalance: 800,
          insurancePayOutBalance: 300,
          insurancePayInReserved: 10,
          insurancePayOutReserved: 20,
          lastAcceptedDealAt: null,
          ...overrides,
        }) as Wallet;

      const settings = (overrides: Partial<TraderSettings> = {}) =>
        ({
          userId: uuidOf(7),
          individualRatesEnabled: false,
          insurancePayInMin: null,
          ...overrides,
        }) as TraderSettings;

      const listed = async (rows: User[]) => {
        userDirectory.list.mockResolvedValue(pageOf(rows));

        return (await controller.list(query())).items;
      };

      it('gives a trader every wallet amount, its minimum, its rates and its leads', async () => {
        wallets.findByUserIds.mockResolvedValue([wallet()]);
        traderSettings.findByUserIds.mockResolvedValue([
          settings({ insurancePayInMin: 1000 }),
        ]);
        team.leadsOf.mockResolvedValue(
          new Map([
            [uuidOf(7), [{ id: uuidOf(20), login: 'lead@example.com' }]],
          ]),
        );

        const [row] = await listed([user()]);

        expect(row.balances).toEqual({
          mainBalance: 1000,
          mainReserved: 250,
          availableMain: 750,
          insurancePayInBalance: 800,
          insurancePayOutBalance: 300,
          insurancePayInReserved: 10,
          insurancePayOutReserved: 20,
          lastAcceptedDealAt: null,
        });
        expect(row.insurancePayInMin).toBe(1000);
        expect(row.rates).toEqual(traderBase);
        expect(row.leads).toEqual([
          { id: uuidOf(20), login: 'lead@example.com' },
        ]);
        expect(row.subordinates).toBeNull();
        expect(row.merchant).toBeNull();
      });

      it('gives a trader with no lead an empty list, not null', async () => {
        const [row] = await listed([user()]);

        expect(row.leads).toEqual([]);
      });

      it('gives a lead trader its subordinates and no rates, since a lead has no rate of its own', async () => {
        team.subordinatesOf.mockResolvedValue(
          new Map([[uuidOf(7), [{ id: uuidOf(30), login: 'trader3_tg' }]]]),
        );

        const [row] = await listed([user({ role: Role.LeadTrader })]);

        expect(rateService.getEffectiveGeneralRates).not.toHaveBeenCalled();
        expect(row.rates).toBeNull();
        expect(row.insurancePayInMin).toBe(GLOBAL_MIN);
        expect(row.subordinates).toEqual([
          { id: uuidOf(30), login: 'trader3_tg' },
        ]);
        expect(row.leads).toBeNull();
        expect(row.merchant).toBeNull();
      });

      it('honours the individual-rates flag of each account', async () => {
        traderSettings.findByUserIds.mockResolvedValue([
          settings({ individualRatesEnabled: true }),
        ]);
        const individual = [
          {
            method: 'sbp',
            payInPercent: 8,
            payOutPercent: 1.2,
          },
        ];
        rateService.getEffectiveGeneralRates.mockResolvedValue({
          base: traderBase,
          bySubject: new Map([[uuidOf(7), individual]]),
        });

        const [row] = await listed([user(), user({ id: uuidOf(8) })]);

        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledWith(
          RateScope.Trader,
          [
            { userId: uuidOf(7), individualEnabled: true },
            { userId: uuidOf(8), individualEnabled: false },
          ],
        );
        expect(row.rates).toEqual(individual);
      });

      it('reports a trader with no wallet yet as having no balances', async () => {
        const [row] = await listed([user()]);

        expect(row.balances).toBeNull();
        expect(row.insurancePayInMin).toBe(GLOBAL_MIN);
      });

      it.each([Role.Merchant, Role.MerchantSupport, Role.MerchantAgent])(
        'gives a %s its merchant and nothing a trader has',
        async (role) => {
          merchants.findByIds.mockResolvedValue([
            { id: uuidOf(50), name: 'Ohla Shop', active: true },
          ]);

          const [row] = await listed([user({ role, merchantId: uuidOf(50) })]);

          expect(row.merchant).toEqual({ id: uuidOf(50), name: 'Ohla Shop' });
          expect(row.balances).toBeNull();
          expect(row.insurancePayInMin).toBeNull();
          expect(row.rates).toBeNull();
          expect(row.leads).toBeNull();
          expect(row.subordinates).toBeNull();
        },
      );

      it('reports a merchant account bound to no merchant as null', async () => {
        const [row] = await listed([
          user({ role: Role.Merchant, merchantId: null }),
        ]);

        expect(row.merchant).toBeNull();
        expect(merchants.findByIds).toHaveBeenCalledWith([]);
      });

      it.each([Role.Cascade, Role.Admin, Role.Superadmin])(
        'gives a %s null for every role-dependent field',
        async (role) => {
          wallets.findByUserIds.mockResolvedValue([wallet()]);

          const [row] = await listed([user({ role, merchantId: uuidOf(50) })]);

          expect(row.balances).toBeNull();
          expect(row.insurancePayInMin).toBeNull();
          expect(row.rates).toBeNull();
          expect(row.leads).toBeNull();
          expect(row.subordinates).toBeNull();
          expect(row.merchant).toBeNull();
        },
      );

      it('composes a whole page with one call per source, never one per row', async () => {
        const rows = [
          user({ id: uuidOf(1), role: Role.Trader }),
          user({ id: uuidOf(2), role: Role.Trader }),
          user({ id: uuidOf(3), role: Role.Trader }),
          user({ id: uuidOf(4), role: Role.LeadTrader }),
          user({ id: uuidOf(5), role: Role.LeadTrader }),
          user({ id: uuidOf(6), role: Role.Merchant, merchantId: uuidOf(50) }),
          user({
            id: uuidOf(7),
            role: Role.MerchantSupport,
            merchantId: uuidOf(50),
          }),
          user({
            id: uuidOf(8),
            role: Role.MerchantAgent,
            merchantId: uuidOf(51),
          }),
          user({ id: uuidOf(9), role: Role.Cascade }),
          user({ id: uuidOf(10), role: Role.Admin }),
        ];

        await listed(rows);

        const trading = [uuidOf(1), uuidOf(2), uuidOf(3), uuidOf(4), uuidOf(5)];

        expect(wallets.findByUserIds).toHaveBeenCalledTimes(1);
        expect(wallets.findByUserIds).toHaveBeenCalledWith(trading);
        expect(traderSettings.findByUserIds).toHaveBeenCalledTimes(1);
        expect(traderSettings.findByUserIds).toHaveBeenCalledWith(trading);
        expect(team.leadsOf).toHaveBeenCalledTimes(1);
        expect(team.leadsOf).toHaveBeenCalledWith([
          uuidOf(1),
          uuidOf(2),
          uuidOf(3),
        ]);
        expect(team.subordinatesOf).toHaveBeenCalledTimes(1);
        expect(team.subordinatesOf).toHaveBeenCalledWith([
          uuidOf(4),
          uuidOf(5),
        ]);
        expect(merchants.findByIds).toHaveBeenCalledTimes(1);
        expect(merchants.findByIds).toHaveBeenCalledWith([
          uuidOf(50),
          uuidOf(51),
        ]);
        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledTimes(1);
        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledWith(
          RateScope.Trader,
          expect.any(Array),
        );
      });

      it('asks for no rates at all when the page holds no trader or lead', async () => {
        await listed([
          user({ role: Role.Admin }),
          user({ id: uuidOf(8), role: Role.Cascade }),
        ]);

        expect(rateService.getEffectiveGeneralRates).not.toHaveBeenCalled();
        expect(wallets.findByUserIds).toHaveBeenCalledWith([]);
        expect(traderSettings.findByUserIds).toHaveBeenCalledWith([]);
        expect(team.leadsOf).toHaveBeenCalledWith([]);
        expect(team.subordinatesOf).toHaveBeenCalledWith([]);
        expect(merchants.findByIds).toHaveBeenCalledWith([]);
      });

      it('asks for the trader scope once for a page of traders', async () => {
        await listed([user()]);

        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledTimes(1);
        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledWith(
          RateScope.Trader,
          [{ userId: uuidOf(7), individualEnabled: false }],
        );
      });
    });
  });

  it.each(['addLead', 'removeLead'] as const)('marks %s as a write', (name) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminUsersController.prototype[name],
      ),
    ).toBe(true);
  });

  describe('leads', () => {
    const leads = [{ id: uuidOf(20), login: 'lead@example.com' }];

    beforeEach(() => {
      userDirectory.findById.mockResolvedValue(user());
      team.leadsOf.mockResolvedValue(new Map([[uuidOf(7), leads]]));
    });

    const assignment = {
      leadUserId: uuidOf(20),
      currencyId: 1,
      payInPercent: 2.5,
      payOutPercent: 0.5,
    };

    const calls = {
      addLead: (editor: AuthenticatedUser, id = uuidOf(7)) =>
        controller.addLead(id, assignment, editor),
      removeLead: (editor: AuthenticatedUser, id = uuidOf(7)) =>
        controller.removeLead(id, uuidOf(20), editor),
    };

    it('links the lead through the owning module and answers with the leads', async () => {
      const result = await calls.addLead(admin);

      expect(team.addLead).toHaveBeenCalledWith(
        uuidOf(7),
        assignment,
        uuidOf(1),
      );
      expect(team.leadsOf).toHaveBeenCalledWith([uuidOf(7)]);
      expect(result).toEqual(leads);
    });

    it('unlinks the lead through the owning module and answers with the rest', async () => {
      team.leadsOf.mockResolvedValue(new Map());

      const result = await calls.removeLead(admin);

      expect(team.removeLead).toHaveBeenCalledWith(
        uuidOf(7),
        uuidOf(20),
        uuidOf(1),
      );
      expect(result).toEqual([]);
    });

    it.each(Object.keys(calls) as (keyof typeof calls)[])(
      '%s refuses an admin acting on their own account',
      async (name) => {
        await expect(calls[name](admin, admin.id)).rejects.toThrow(
          ForbiddenException,
        );

        expect(userDirectory.findById).not.toHaveBeenCalled();
        expect(team[name]).not.toHaveBeenCalled();
      },
    );

    it.each(Object.keys(calls) as (keyof typeof calls)[])(
      '%s reports a target that does not exist as not found',
      async (name) => {
        userDirectory.findById.mockResolvedValue(null);

        await expect(calls[name](admin)).rejects.toThrow(NotFoundException);

        expect(team[name]).not.toHaveBeenCalled();
      },
    );

    it.each(
      (Object.keys(calls) as (keyof typeof calls)[]).flatMap((name) =>
        [Role.Admin, Role.Superadmin].map((role) => [name, role] as const),
      ),
    )('%s refuses an admin acting on a %s', async (name, role) => {
      userDirectory.findById.mockResolvedValue(user({ role }));

      await expect(calls[name](admin)).rejects.toThrow(ForbiddenException);

      expect(team[name]).not.toHaveBeenCalled();
    });

    it('lets a superadmin act on any account the policy allows', async () => {
      userDirectory.findById.mockResolvedValue(user({ role: Role.Admin }));

      await calls.addLead(superadmin);

      expect(team.addLead).toHaveBeenCalled();
    });

    it('passes a refusal from the owning module through untouched', async () => {
      team.addLead.mockRejectedValue(new ConflictException('already linked'));

      await expect(calls.addLead(admin)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('changes the email on its own', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ email: 'new@example.com' }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { email: 'new@example.com' },
        admin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        email: 'new@example.com',
      });
      expect(edited.email).toBe('new@example.com');
    });

    it('changes the telegram username on its own', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ telegramUsername: 'durov' }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { telegramUsername: '@durov' },
        admin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        telegramUsername: '@durov',
      });
      expect(edited.telegramUsername).toBe('durov');
    });

    it('changes the role on its own', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ role: Role.LeadTrader }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { role: Role.LeadTrader },
        admin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        role: Role.LeadTrader,
      });
      expect(edited.role).toBe(Role.LeadTrader);
    });

    it('changes the status on its own', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ status: UserStatus.Suspended }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { status: UserStatus.Suspended },
        admin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        status: UserStatus.Suspended,
      });
      expect(edited.status).toBe(UserStatus.Suspended);
    });

    it('changes the password on its own', async () => {
      userDirectory.findById.mockResolvedValue(user());
      passwords.setPassword.mockResolvedValue(user());

      const edited = await controller.update(
        uuidOf(7),
        { password: 'a brand new password' },
        superadmin,
      );

      expect(passwords.setPassword).toHaveBeenCalledWith(
        uuidOf(7),
        { password: 'a brand new password' },
        superadmin.id,
      );
      expect(edited).not.toHaveProperty('password');
      expect(edited).not.toHaveProperty('passwordHash');
    });

    it('changes several fields in one request', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({
          email: 'new@example.com',
          role: Role.Merchant,
          status: UserStatus.Suspended,
        }),
      );

      const edited = await controller.update(
        uuidOf(7),
        {
          email: 'new@example.com',
          role: Role.Merchant,
          status: UserStatus.Suspended,
        },
        superadmin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        email: 'new@example.com',
        role: Role.Merchant,
        status: UserStatus.Suspended,
      });
      expect(edited.email).toBe('new@example.com');
      expect(edited.role).toBe(Role.Merchant);
      expect(edited.status).toBe(UserStatus.Suspended);
    });

    it('gives a user both an email and a telegram username', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ email: 'user@example.com', telegramUsername: 'durov' }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { email: 'user@example.com', telegramUsername: 'durov' },
        admin,
      );

      expect(edited.email).toBe('user@example.com');
      expect(edited.telegramUsername).toBe('durov');
    });

    it('refuses a body with no field at all', async () => {
      await expect(controller.update(uuidOf(7), {}, admin)).rejects.toThrow(
        BadRequestException,
      );

      expect(userDirectory.findById).not.toHaveBeenCalled();
      expect(userAdministration.update).not.toHaveBeenCalled();
    });

    it.each([
      ['an admin', admin],
      ['a superadmin', superadmin],
    ])('refuses %s editing their own account', async (_label, editor) => {
      await expect(
        controller.update(editor.id, { status: UserStatus.Suspended }, editor),
      ).rejects.toThrow(ForbiddenException);

      expect(userDirectory.findById).not.toHaveBeenCalled();
      expect(userAdministration.update).not.toHaveBeenCalled();
    });

    it.each([Role.Admin, Role.Superadmin])(
      'refuses an admin editing a %s',
      async (role) => {
        userDirectory.findById.mockResolvedValue(user({ role }));

        await expect(
          controller.update(uuidOf(7), { status: UserStatus.Blocked }, admin),
        ).rejects.toThrow(ForbiddenException);

        expect(userAdministration.update).not.toHaveBeenCalled();
      },
    );

    it.each([Role.Admin, Role.Superadmin, Role.Trader])(
      'lets a superadmin edit a %s',
      async (role) => {
        userDirectory.findById.mockResolvedValue(user({ role }));
        userAdministration.update.mockResolvedValue(
          user({ role, status: UserStatus.Blocked }),
        );

        await controller.update(
          uuidOf(7),
          { status: UserStatus.Blocked },
          superadmin,
        );

        expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
          status: UserStatus.Blocked,
        });
      },
    );

    it.each([Role.Admin, Role.Superadmin])(
      'refuses an admin promoting a trader to %s',
      async (role) => {
        userDirectory.findById.mockResolvedValue(user());

        await expect(
          controller.update(uuidOf(7), { role }, admin),
        ).rejects.toThrow(ForbiddenException);

        expect(userAdministration.update).not.toHaveBeenCalled();
      },
    );

    it.each([Role.Admin, Role.Superadmin])(
      'lets a superadmin promote a trader to %s',
      async (role) => {
        userDirectory.findById.mockResolvedValue(user());
        userAdministration.update.mockResolvedValue(user({ role }));

        const edited = await controller.update(uuidOf(7), { role }, superadmin);

        expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
          role,
        });
        expect(edited.role).toBe(role);
      },
    );

    it('lets an admin issue a role it may issue', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(user({ role: Role.Cascade }));

      const edited = await controller.update(
        uuidOf(7),
        { role: Role.Cascade },
        admin,
      );

      expect(edited.role).toBe(Role.Cascade);
    });

    it('writes a password together with its session revocation in the owning module', async () => {
      userDirectory.findById.mockResolvedValue(user());
      passwords.setPassword.mockResolvedValue(user());

      await controller.update(
        uuidOf(7),
        { password: 'a brand new password', status: UserStatus.Suspended },
        superadmin,
      );

      expect(passwords.setPassword).toHaveBeenCalledWith(
        uuidOf(7),
        { password: 'a brand new password', status: UserStatus.Suspended },
        superadmin.id,
      );
      expect(userAdministration.update).not.toHaveBeenCalled();
      expect(sessions.revokeAllSessionsAudited).not.toHaveBeenCalled();
    });

    it('does not answer success when the password could not be written', async () => {
      userDirectory.findById.mockResolvedValue(user());
      passwords.setPassword.mockRejectedValue(
        new Error('conflicting identifier'),
      );

      await expect(
        controller.update(
          uuidOf(7),
          { password: 'a brand new password' },
          superadmin,
        ),
      ).rejects.toThrow('conflicting identifier');
    });

    it.each([
      ['an email change', { email: 'new@example.com' }],
      ['a role change', { role: Role.Merchant }],
      ['a status change', { status: UserStatus.Suspended }],
      ['a telegram change', { telegramUsername: 'durov' }],
    ])('leaves the sessions alone on %s', async (_label, changes) => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(user());

      await controller.update(uuidOf(7), changes, admin);

      expect(sessions.revokeAllSessionsAudited).not.toHaveBeenCalled();
    });

    it('resets the second factor through the owning module', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userEnrolment.resetTwoFactor.mockResolvedValue(
        user({ status: UserStatus.PendingTwoFactor, totpSecret: null }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { resetTwoFactor: true },
        superadmin,
      );

      expect(userEnrolment.resetTwoFactor).toHaveBeenCalledWith(uuidOf(7));
      expect(edited.status).toBe(UserStatus.PendingTwoFactor);
    });

    it('never hands the admin the new secret', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userEnrolment.resetTwoFactor.mockResolvedValue(
        user({
          status: UserStatus.PendingTwoFactor,
          totpSecret: 'NEWSECRET2222222',
        }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { resetTwoFactor: true },
        superadmin,
      );

      expect(edited).not.toHaveProperty('secret');
      expect(edited).not.toHaveProperty('otpauthUrl');
      expect(edited).not.toHaveProperty('totpSecret');
      expect(edited).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(edited)).not.toContain('NEWSECRET2222222');
    });

    it('leaves the second factor alone when the flag is false', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ status: UserStatus.Suspended }),
      );

      await controller.update(
        uuidOf(7),
        { status: UserStatus.Suspended, resetTwoFactor: false },
        superadmin,
      );

      expect(userEnrolment.resetTwoFactor).not.toHaveBeenCalled();
      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        status: UserStatus.Suspended,
      });
    });

    it('applies the changes before the side effects and returns the last state', async () => {
      userDirectory.findById.mockResolvedValue(user());
      passwords.setPassword.mockResolvedValue(
        user({ email: 'new@example.com' }),
      );
      userEnrolment.resetTwoFactor.mockResolvedValue(
        user({
          email: 'new@example.com',
          status: UserStatus.PendingTwoFactor,
        }),
      );

      const edited = await controller.update(
        uuidOf(7),
        {
          email: 'new@example.com',
          password: 'a brand new password',
          resetTwoFactor: true,
        },
        superadmin,
      );

      expect(passwords.setPassword).toHaveBeenCalledWith(
        uuidOf(7),
        { email: 'new@example.com', password: 'a brand new password' },
        superadmin.id,
      );
      expect(userEnrolment.resetTwoFactor).toHaveBeenCalledWith(uuidOf(7));
      expect(edited.email).toBe('new@example.com');
      expect(edited.status).toBe(UserStatus.PendingTwoFactor);
    });

    it('reaches a blocked user, whom an authenticatable finder would hide', async () => {
      userDirectory.findById.mockResolvedValue(
        user({ status: UserStatus.Blocked }),
      );
      userAdministration.update.mockResolvedValue(
        user({ status: UserStatus.Active }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { status: UserStatus.Active },
        admin,
      );

      expect(userDirectory.findById).toHaveBeenCalledWith(uuidOf(7));
      expect(edited.status).toBe(UserStatus.Active);
    });

    it('reports a target that does not exist as not found', async () => {
      userDirectory.findById.mockResolvedValue(null);

      await expect(
        controller.update(uuidOf(7), { status: UserStatus.Active }, admin),
      ).rejects.toThrow(NotFoundException);

      expect(userAdministration.update).not.toHaveBeenCalled();
    });
  });

  describe('the fields only a superadmin may send', () => {
    it.each([
      ['a password', { password: 'a brand new password' }],
      ['a second-factor reset', { resetTwoFactor: true }],
      ['a second-factor reset set to false', { resetTwoFactor: false }],
      [
        'a password beside an ordinary field',
        { status: UserStatus.Suspended, password: 'a brand new password' },
      ],
    ])('refuses an admin sending %s', async (_label, changes) => {
      userDirectory.findById.mockResolvedValue(user());

      await expect(
        controller.update(uuidOf(7), changes, admin),
      ).rejects.toThrow(ForbiddenException);

      expect(userAdministration.update).not.toHaveBeenCalled();
      expect(userEnrolment.resetTwoFactor).not.toHaveBeenCalled();
      expect(sessions.revokeAllSessionsAudited).not.toHaveBeenCalled();
    });

    it('still lets an admin change the other fields', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ status: UserStatus.Suspended }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { status: UserStatus.Suspended },
        admin,
      );

      expect(edited.status).toBe(UserStatus.Suspended);
    });

    it('lets a superadmin set a password', async () => {
      userDirectory.findById.mockResolvedValue(user());
      passwords.setPassword.mockResolvedValue(user());

      await controller.update(
        uuidOf(7),
        { password: 'a brand new password' },
        superadmin,
      );

      expect(passwords.setPassword).toHaveBeenCalledWith(
        uuidOf(7),
        { password: 'a brand new password' },
        superadmin.id,
      );
    });
  });

  describe('blocking', () => {
    it('lets an admin block a trader', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ status: UserStatus.Blocked }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { status: UserStatus.Blocked },
        admin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        status: UserStatus.Blocked,
      });
      expect(edited.status).toBe(UserStatus.Blocked);
    });

    it('lets an admin unblock a trader', async () => {
      userDirectory.findById.mockResolvedValue(
        user({ status: UserStatus.Blocked }),
      );
      userAdministration.update.mockResolvedValue(
        user({ status: UserStatus.Active }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { status: UserStatus.Active },
        admin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        status: UserStatus.Active,
      });
      expect(edited.status).toBe(UserStatus.Active);
    });
  });

  describe('the sessions a superadmin opened through login links', () => {
    const otherSuperadmin = (overrides: Partial<User> = {}): User =>
      user({ role: Role.Superadmin, ...overrides });

    it.each([
      [
        'blocked',
        { status: UserStatus.Blocked },
        { status: UserStatus.Blocked },
      ],
      [
        'suspended',
        { status: UserStatus.Suspended },
        { status: UserStatus.Suspended },
      ],
      ['demoted', { role: Role.Admin }, { role: Role.Admin }],
      [
        'demoted and suspended at once',
        { role: Role.Trader, status: UserStatus.Suspended },
        { role: Role.Trader, status: UserStatus.Suspended },
      ],
    ])(
      'are revoked when the superadmin is %s',
      async (_label, changes, after) => {
        userDirectory.findById.mockResolvedValue(otherSuperadmin());
        userAdministration.update.mockResolvedValue(otherSuperadmin(after));

        await controller.update(uuidOf(7), changes, superadmin);

        expect(sessions.revokeImpersonationSessions).toHaveBeenCalledWith(
          uuidOf(7),
        );
        expect(sessions.revokeAllSessionsAudited).not.toHaveBeenCalled();
        expect(loginLinks.invalidateIssuedBy).toHaveBeenCalledWith(uuidOf(7));
      },
    );

    it('are revoked when the second factor of the superadmin is reset', async () => {
      userDirectory.findById.mockResolvedValue(otherSuperadmin());
      userEnrolment.resetTwoFactor.mockResolvedValue(
        otherSuperadmin({ status: UserStatus.PendingTwoFactor }),
      );

      await controller.update(uuidOf(7), { resetTwoFactor: true }, superadmin);

      expect(sessions.revokeImpersonationSessions).toHaveBeenCalledWith(
        uuidOf(7),
      );
    });

    it('are revoked only after the change itself was written', async () => {
      const order: string[] = [];
      userDirectory.findById.mockResolvedValue(otherSuperadmin());
      userAdministration.update.mockImplementation(async () => {
        order.push('update');

        return otherSuperadmin({ status: UserStatus.Blocked });
      });
      sessions.revokeImpersonationSessions.mockImplementation(async () => {
        order.push('revoke');
      });

      await controller.update(
        uuidOf(7),
        { status: UserStatus.Blocked },
        superadmin,
      );

      expect(order).toEqual(['update', 'revoke']);
    });

    it.each([
      ['given another email', { email: 'root2@example.com' }],
      ['re-confirmed as a superadmin', { role: Role.Superadmin }],
    ])(
      'are left alone when the superadmin is only %s',
      async (_label, changes) => {
        userDirectory.findById.mockResolvedValue(otherSuperadmin());
        userAdministration.update.mockResolvedValue(
          otherSuperadmin(changes as Partial<User>),
        );

        await controller.update(uuidOf(7), changes, superadmin);

        expect(sessions.revokeImpersonationSessions).not.toHaveBeenCalled();
        expect(loginLinks.invalidateIssuedBy).not.toHaveBeenCalled();
      },
    );

    it('are not looked for when a trader is blocked', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
        user({ status: UserStatus.Blocked }),
      );

      await controller.update(uuidOf(7), { status: UserStatus.Blocked }, admin);

      expect(sessions.revokeImpersonationSessions).not.toHaveBeenCalled();
      expect(loginLinks.invalidateIssuedBy).not.toHaveBeenCalled();
    });

    it('are not looked for when an admin is promoted to superadmin', async () => {
      userDirectory.findById.mockResolvedValue(user({ role: Role.Admin }));
      userAdministration.update.mockResolvedValue(
        user({ role: Role.Superadmin }),
      );

      await controller.update(uuidOf(7), { role: Role.Superadmin }, superadmin);

      expect(sessions.revokeImpersonationSessions).not.toHaveBeenCalled();
    });
  });

  describe('link sessions opened into an account that is promoted', () => {
    it.each([Role.Admin, Role.Superadmin])(
      'are revoked when a trader becomes %s, after the change was written',
      async (role) => {
        const order: string[] = [];
        userDirectory.findById.mockResolvedValue(user());
        userAdministration.update.mockImplementation(async () => {
          order.push('update');

          return user({ role });
        });
        sessions.revokeImpersonatedSessions.mockImplementation(async () => {
          order.push('revoke');
        });

        await controller.update(uuidOf(7), { role }, superadmin);

        expect(sessions.revokeImpersonatedSessions).toHaveBeenCalledWith(
          uuidOf(7),
        );
        expect(order).toEqual(['update', 'revoke']);
      },
    );

    it.each([
      ['a trader stays unprotected', user(), Role.LeadTrader],
      ['an admin is promoted', user({ role: Role.Admin }), Role.Superadmin],
    ])('are not looked for when %s', async (_label, before, role) => {
      userDirectory.findById.mockResolvedValue(before);
      userAdministration.update.mockResolvedValue(user({ role }));

      await controller.update(uuidOf(7), { role }, superadmin);

      expect(sessions.revokeImpersonatedSessions).not.toHaveBeenCalled();
    });
  });

  describe('who reaches the superadmin-only handlers', () => {
    const contextFor = (
      handler: (...args: never[]) => unknown,
      caller: AuthenticatedUser,
    ): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => AdminUsersController,
        switchToHttp: () => ({ getRequest: () => ({ user: caller }) }),
      }) as unknown as ExecutionContext;

    const guard = new RolesGuard(new Reflector());

    it.each(['resetPassword', 'issueLoginLink'] as const)(
      '%s refuses an admin before the handler runs',
      (name) => {
        expect(() =>
          guard.canActivate(
            contextFor(AdminUsersController.prototype[name], admin),
          ),
        ).toThrow(ForbiddenException);
      },
    );

    it.each(['resetPassword', 'issueLoginLink'] as const)(
      '%s lets a superadmin through',
      (name) => {
        expect(
          guard.canActivate(
            contextFor(AdminUsersController.prototype[name], superadmin),
          ),
        ).toBe(true);
      },
    );

    it('revokeSessions lets an admin through', () => {
      expect(
        guard.canActivate(
          contextFor(AdminUsersController.prototype.revokeSessions, admin),
        ),
      ).toBe(true);
    });
  });

  describe('revokeSessions', () => {
    it('is a write open to admins and superadmins', () => {
      const handler = AdminUsersController.prototype.revokeSessions;

      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
        true,
      );
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toBeUndefined();
    });

    it('revokes every session of the user through the owning module', async () => {
      userDirectory.findById.mockResolvedValue(user());

      await expect(
        controller.revokeSessions(uuidOf(7), admin),
      ).resolves.toBeNull();

      expect(sessions.revokeAllSessionsAudited).toHaveBeenCalledWith(
        uuidOf(7),
        admin.id,
      );
    });

    it('answers the same for a user with no session, so a repeat is harmless', async () => {
      userDirectory.findById.mockResolvedValue(user());
      sessions.revokeAllSessionsAudited.mockResolvedValue(undefined);

      await controller.revokeSessions(uuidOf(7), admin);
      await expect(
        controller.revokeSessions(uuidOf(7), admin),
      ).resolves.toBeNull();

      expect(sessions.revokeAllSessionsAudited).toHaveBeenCalledTimes(2);
    });

    it('reports a target that does not exist as not found', async () => {
      userDirectory.findById.mockResolvedValue(null);

      await expect(controller.revokeSessions(uuidOf(7), admin)).rejects.toThrow(
        NotFoundException,
      );

      expect(sessions.revokeAllSessionsAudited).not.toHaveBeenCalled();
    });

    it('refuses the caller signing themselves out this way', async () => {
      await expect(controller.revokeSessions(admin.id, admin)).rejects.toThrow(
        ForbiddenException,
      );

      expect(sessions.revokeAllSessionsAudited).not.toHaveBeenCalled();
    });

    it.each([Role.Admin, Role.Superadmin])(
      'refuses an admin acting on a %s',
      async (role) => {
        userDirectory.findById.mockResolvedValue(user({ role }));

        await expect(
          controller.revokeSessions(uuidOf(7), admin),
        ).rejects.toThrow(ForbiddenException);

        expect(sessions.revokeAllSessionsAudited).not.toHaveBeenCalled();
      },
    );

    it('lets a superadmin sign out an admin', async () => {
      userDirectory.findById.mockResolvedValue(user({ role: Role.Admin }));

      await controller.revokeSessions(uuidOf(7), superadmin);

      expect(sessions.revokeAllSessionsAudited).toHaveBeenCalledWith(
        uuidOf(7),
        superadmin.id,
      );
    });
  });

  describe('resetPassword', () => {
    it('is a write reserved to superadmins', () => {
      const handler = AdminUsersController.prototype.resetPassword;

      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
        true,
      );
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toEqual([
        Role.Superadmin,
      ]);
    });

    it('answers with the generated password and nothing else', async () => {
      userDirectory.findById.mockResolvedValue(user());
      passwords.issueGeneratedPassword.mockResolvedValue('q8ZtR2mWk4Ya');

      const result = await controller.resetPassword(uuidOf(7), superadmin);

      expect(passwords.issueGeneratedPassword).toHaveBeenCalledWith(
        uuidOf(7),
        superadmin.id,
      );
      expect(result).toEqual({ password: 'q8ZtR2mWk4Ya' });
    });

    it('leaves the second factor alone', async () => {
      userDirectory.findById.mockResolvedValue(user());
      passwords.issueGeneratedPassword.mockResolvedValue('q8ZtR2mWk4Ya');

      await controller.resetPassword(uuidOf(7), superadmin);

      expect(userEnrolment.resetTwoFactor).not.toHaveBeenCalled();
    });

    it('reports a target that does not exist as not found', async () => {
      userDirectory.findById.mockResolvedValue(null);

      await expect(
        controller.resetPassword(uuidOf(7), superadmin),
      ).rejects.toThrow(NotFoundException);

      expect(passwords.issueGeneratedPassword).not.toHaveBeenCalled();
    });

    it('refuses a superadmin resetting their own password', async () => {
      await expect(
        controller.resetPassword(superadmin.id, superadmin),
      ).rejects.toThrow(ForbiddenException);

      expect(passwords.issueGeneratedPassword).not.toHaveBeenCalled();
    });
  });

  describe('issueLoginLink', () => {
    const issued = {
      code: 'a-high-entropy-code',
      url: 'https://app.example.com/login-link?code=a-high-entropy-code',
      expiresAt: new Date('2026-10-24T12:15:00Z'),
    };

    it('is a write reserved to superadmins', () => {
      const handler = AdminUsersController.prototype.issueLoginLink;

      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
        true,
      );
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toEqual([
        Role.Superadmin,
      ]);
    });

    it.each([
      Role.Trader,
      Role.LeadTrader,
      Role.Merchant,
      Role.MerchantSupport,
      Role.MerchantAgent,
      Role.Cascade,
    ])('issues a link for a %s, naming the superadmin', async (role) => {
      userDirectory.findById.mockResolvedValue(user({ role }));
      loginLinks.issue.mockResolvedValue(issued);

      await expect(
        controller.issueLoginLink(uuidOf(7), superadmin),
      ).resolves.toEqual(issued);

      expect(loginLinks.issue).toHaveBeenCalledWith(uuidOf(7), superadmin.id);
    });

    it.each([Role.Admin, Role.Superadmin])(
      'refuses a link for a %s, although a superadmin may otherwise act on one',
      async (role) => {
        userDirectory.findById.mockResolvedValue(user({ role }));

        await expect(
          controller.issueLoginLink(uuidOf(7), superadmin),
        ).rejects.toThrow(ForbiddenException);

        expect(loginLinks.issue).not.toHaveBeenCalled();
      },
    );

    it.each([UserStatus.Blocked, UserStatus.PendingTwoFactor])(
      'refuses a link for a %s account with a 409',
      async (status) => {
        userDirectory.findById.mockResolvedValue(user({ status }));

        await expect(
          controller.issueLoginLink(uuidOf(7), superadmin),
        ).rejects.toThrow(ConflictException);

        expect(loginLinks.issue).not.toHaveBeenCalled();
      },
    );

    it('still issues a link for a suspended account, whose session is read-only', async () => {
      userDirectory.findById.mockResolvedValue(
        user({ status: UserStatus.Suspended }),
      );
      loginLinks.issue.mockResolvedValue(issued);

      await expect(
        controller.issueLoginLink(uuidOf(7), superadmin),
      ).resolves.toEqual(issued);
    });

    it('refuses a link for the caller themselves', async () => {
      await expect(
        controller.issueLoginLink(superadmin.id, superadmin),
      ).rejects.toThrow(ForbiddenException);

      expect(userDirectory.findById).not.toHaveBeenCalled();
      expect(loginLinks.issue).not.toHaveBeenCalled();
    });

    it('reports a target that does not exist as not found', async () => {
      userDirectory.findById.mockResolvedValue(null);

      await expect(
        controller.issueLoginLink(uuidOf(7), superadmin),
      ).rejects.toThrow(NotFoundException);

      expect(loginLinks.issue).not.toHaveBeenCalled();
    });
  });
});
