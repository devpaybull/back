import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { SessionService } from '../../auth/services/session.service';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
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
import { TransactionMethod } from '../../transactions/types/transaction-method.enum';
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
    revokeAllSessions: jest.fn(),
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

  const GLOBAL_MIN = 500;

  const traderBase = [
    { method: TransactionMethod.Sbp, payInPercent: 8.5, payOutPercent: 1.5 },
  ];
  const leadBase = [
    { method: TransactionMethod.Sbp, payInPercent: 2, payOutPercent: 0.5 },
  ];

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
      async (scope: RateScope, subjects: RateSubject[]) => {
        const base = scope === RateScope.Lead ? leadBase : traderBase;

        return {
          base,
          bySubject: new Map(subjects.map(({ userId }) => [userId, base])),
        };
      },
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

  describe('list', () => {
    it('hands the whole query to the module that owns the data', async () => {
      userDirectory.list.mockResolvedValue(pageOf([user()]));

      const asked = query({
        page: 2,
        limit: 50,
        search: 'durov',
        role: Role.Trader,
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
        'telegramUsername',
      ]);
    });

    it('falls back to the telegram username as the login', async () => {
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

      it('gives a lead trader the lead-scope rates and its subordinates', async () => {
        team.subordinatesOf.mockResolvedValue(
          new Map([[uuidOf(7), [{ id: uuidOf(30), login: 'trader3_tg' }]]]),
        );

        const [row] = await listed([user({ role: Role.LeadTrader })]);

        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledTimes(1);
        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledWith(
          RateScope.Lead,
          [{ userId: uuidOf(7), individualEnabled: false }],
        );
        expect(row.rates).toEqual(leadBase);
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
            method: TransactionMethod.Sbp,
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
        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledTimes(2);
        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledWith(
          RateScope.Trader,
          expect.any(Array),
        );
        expect(rateService.getEffectiveGeneralRates).toHaveBeenCalledWith(
          RateScope.Lead,
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

      it('asks for the lead scope only when a lead is on the page', async () => {
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

    const calls = {
      addLead: (editor: AuthenticatedUser, id = uuidOf(7)) =>
        controller.addLead(id, { leadUserId: uuidOf(20) }, editor),
      removeLead: (editor: AuthenticatedUser, id = uuidOf(7)) =>
        controller.removeLead(id, uuidOf(20), editor),
    };

    it('links the lead through the owning module and answers with the leads', async () => {
      const result = await calls.addLead(admin);

      expect(team.addLead).toHaveBeenCalledWith(
        uuidOf(7),
        uuidOf(20),
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
      userAdministration.update.mockResolvedValue(user());

      const edited = await controller.update(
        uuidOf(7),
        { password: 'a brand new password' },
        admin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        password: 'a brand new password',
      });
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

    it('revokes every session after a password change', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(user());

      await controller.update(
        uuidOf(7),
        { password: 'a brand new password' },
        admin,
      );

      expect(sessions.revokeAllSessions).toHaveBeenCalledWith(uuidOf(7));
    });

    it('revokes sessions only after the update has succeeded', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockRejectedValue(
        new Error('conflicting identifier'),
      );

      await expect(
        controller.update(
          uuidOf(7),
          { password: 'a brand new password' },
          admin,
        ),
      ).rejects.toThrow('conflicting identifier');

      expect(sessions.revokeAllSessions).not.toHaveBeenCalled();
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

      expect(sessions.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('resets the second factor through the owning module', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userEnrolment.resetTwoFactor.mockResolvedValue(
        user({ status: UserStatus.PendingTwoFactor, totpSecret: null }),
      );

      const edited = await controller.update(
        uuidOf(7),
        { resetTwoFactor: true },
        admin,
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
        admin,
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
        admin,
      );

      expect(userEnrolment.resetTwoFactor).not.toHaveBeenCalled();
      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        status: UserStatus.Suspended,
      });
    });

    it('applies the changes before the side effects and returns the last state', async () => {
      userDirectory.findById.mockResolvedValue(user());
      userAdministration.update.mockResolvedValue(
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
        admin,
      );

      expect(userAdministration.update).toHaveBeenCalledWith(uuidOf(7), {
        email: 'new@example.com',
        password: 'a brand new password',
      });
      expect(sessions.revokeAllSessions).toHaveBeenCalledWith(uuidOf(7));
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
});
