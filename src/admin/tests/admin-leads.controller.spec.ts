import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { LeadRate } from '../../transactions/entities/lead-rate.entity';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminLeadsController } from '../controllers/admin-leads.controller';

describe('AdminLeadsController', () => {
  const TRADER = uuidOf(7);
  const LEAD = uuidOf(20);
  const SECOND_TRADER = uuidOf(8);
  const RUB = { id: 1, isocode: 'RUB' };
  const KZT = { id: 2, isocode: 'KZT' };

  const issuer = (role: Role, id = uuidOf(1)): AuthenticatedUser => ({
    id,
    login: 'admin',
    role,
    status: UserStatus.Active,
  });
  const admin = issuer(Role.Admin);

  const account = (overrides: Partial<User>): User =>
    ({
      id: TRADER,
      email: null,
      telegramUsername: 'trader_tg',
      role: Role.Trader,
      ...overrides,
    }) as User;

  const trader = account({});
  const lead = account({
    id: LEAD,
    telegramUsername: 'lead_tg',
    role: Role.LeadTrader,
  });
  const secondTrader = account({
    id: SECOND_TRADER,
    telegramUsername: 'trader2_tg',
  });

  const link = (overrides: Partial<TraderLead> = {}): TraderLead =>
    ({
      id: 70,
      traderUserId: TRADER,
      trader,
      leadUserId: LEAD,
      lead,
      currencyId: RUB.id,
      currency: RUB,
      payInPercent: 2.5,
      payOutPercent: 0.5,
      ...overrides,
    }) as TraderLead;

  const detail = (overrides: Partial<LeadRate>): LeadRate =>
    ({
      traderLeadId: 70,
      method: 'sbp',
      fromAmount: null,
      toAmount: null,
      bankId: null,
      payInPercent: 1,
      payOutPercent: 0.2,
      ...overrides,
    }) as LeadRate;

  let users: Map<string, User>;
  let directory: { findById: jest.Mock };
  let team: {
    assignmentsOf: jest.Mock;
    assignmentsLedBy: jest.Mock;
    replaceLeads: jest.Mock;
    findPair: jest.Mock;
  };
  let rates: {
    getLeadSet: jest.Mock;
    replaceLeadSet: jest.Mock;
  };
  let controller: AdminLeadsController;

  beforeEach(() => {
    users = new Map([
      [TRADER, trader],
      [LEAD, lead],
      [SECOND_TRADER, secondTrader],
    ]);
    directory = {
      findById: jest.fn(async (id: string) => users.get(id) ?? null),
    };
    team = {
      assignmentsOf: jest.fn(async () => [link()]),
      assignmentsLedBy: jest.fn(async () => [link()]),
      replaceLeads: jest.fn(async () => [link()]),
      findPair: jest.fn(async () => [link()]),
    };
    rates = {
      getLeadSet: jest.fn(async () => []),
      replaceLeadSet: jest.fn(async () => []),
    };
    controller = new AdminLeadsController(
      directory as never,
      team as never,
      rates as never,
    );
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminLeadsController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks the two replacements as writes and leaves the reads unmarked', () => {
    for (const write of ['replaceLeads', 'replaceLeadRates'] as const) {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminLeadsController.prototype[write],
        ),
      ).toBe(true);
    }
    for (const read of ['readLeads', 'readLeadRates', 'referrals'] as const) {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminLeadsController.prototype[read],
        ),
      ).toBeUndefined();
    }
  });

  describe('GET /admin/users/:id/leads', () => {
    it('answers the assignment set, one row per lead × currency', async () => {
      await expect(controller.readLeads(TRADER)).resolves.toEqual([
        {
          leadUserId: LEAD,
          login: 'lead_tg',
          currencyId: 1,
          currency: 'RUB',
          payInPercent: 2.5,
          payOutPercent: 0.5,
        },
      ]);
    });

    it('answers 404 for an unknown user', async () => {
      await expect(controller.readLeads(uuidOf(99))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('PUT /admin/users/:id/leads', () => {
    const body = {
      leads: [
        {
          leadUserId: LEAD,
          currencyId: 1,
          payInPercent: 2.5,
          payOutPercent: 0.5,
        },
      ],
    };

    it('replaces the set through the owning module, with the admin as actor', async () => {
      const result = await controller.replaceLeads(TRADER, body, admin);

      expect(team.replaceLeads).toHaveBeenCalledWith(
        TRADER,
        body.leads,
        admin.id,
      );
      expect(result).toHaveLength(1);
    });

    it('answers 403 to an admin editing their own account', async () => {
      await expect(
        controller.replaceLeads(admin.id, body, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(team.replaceLeads).not.toHaveBeenCalled();
    });

    it('answers 403 when the admin may not act on the target role', async () => {
      users.set(TRADER, account({ role: Role.Superadmin }));

      await expect(
        controller.replaceLeads(TRADER, body, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(team.replaceLeads).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown target', async () => {
      await expect(
        controller.replaceLeads(uuidOf(99), body, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('the detailed lead rate', () => {
    it('reads the detail of every currency of the pair in one call', async () => {
      team.findPair.mockResolvedValue([
        link(),
        link({ id: 71, currencyId: 2, currency: KZT as never }),
      ]);
      rates.getLeadSet.mockResolvedValue([
        detail({}),
        detail({ fromAmount: 1000, toAmount: 5000, payInPercent: 0.8 }),
      ]);

      const set = await controller.readLeadRates(TRADER, LEAD);

      expect(team.findPair).toHaveBeenCalledWith(TRADER, LEAD);
      expect(rates.getLeadSet).toHaveBeenCalledWith([70, 71]);
      expect(set).toEqual({
        methods: [
          {
            method: 'sbp',
            general: { payInPercent: 1, payOutPercent: 0.2 },
            bands: [
              {
                fromAmount: 1000,
                toAmount: 5000,
                payInPercent: 0.8,
                payOutPercent: 0.2,
              },
            ],
            banks: [],
          },
        ],
      });
    });

    it('answers 404 when the lead does not lead the trader', async () => {
      team.findPair.mockResolvedValue([]);

      await expect(
        controller.readLeadRates(TRADER, LEAD),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        controller.replaceLeadRates(TRADER, LEAD, { methods: [] }, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rates.replaceLeadSet).not.toHaveBeenCalled();
    });

    it('replaces the detail with absent lists as empty and the pair in the audit', async () => {
      const links = [link()];
      team.findPair.mockResolvedValue(links);

      await controller.replaceLeadRates(
        TRADER,
        LEAD,
        { methods: [{ method: 'sbp' }] },
        admin,
      );

      expect(rates.replaceLeadSet).toHaveBeenCalledWith(
        links,
        [{ method: 'sbp', general: null, bands: [], banks: [] }],
        { actorUserId: admin.id, traderUserId: TRADER, leadUserId: LEAD },
      );
    });

    it('answers 403 to a self-edit and to a target the admin outranks', async () => {
      await expect(
        controller.replaceLeadRates(admin.id, LEAD, { methods: [] }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);

      users.set(TRADER, account({ role: Role.Admin }));

      await expect(
        controller.replaceLeadRates(TRADER, LEAD, { methods: [] }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rates.replaceLeadSet).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/users/:id/referrals', () => {
    it('gives a lead trader its traders, each with the rate summary per currency', async () => {
      team.assignmentsLedBy.mockResolvedValue([
        link(),
        link({
          id: 71,
          currencyId: 2,
          currency: KZT as never,
          payInPercent: 3,
          payOutPercent: 1,
        }),
        link({
          id: 72,
          traderUserId: SECOND_TRADER,
          trader: secondTrader,
          payInPercent: 1,
          payOutPercent: 0.1,
        }),
      ]);
      rates.getLeadSet.mockResolvedValue([
        detail({ payInPercent: 0, payOutPercent: 2 }),
        detail({ fromAmount: 1, toAmount: 2, payInPercent: 14 }),
      ]);

      const referrals = await controller.referrals(LEAD);

      expect(team.assignmentsLedBy).toHaveBeenCalledWith(LEAD);
      expect(rates.getLeadSet).toHaveBeenCalledTimes(1);
      expect(rates.getLeadSet).toHaveBeenCalledWith([70, 71, 72]);
      expect(referrals).toEqual([
        {
          id: TRADER,
          login: 'trader_tg',
          rates: [
            {
              currencyId: 1,
              currency: 'RUB',
              payInMin: 0,
              payInMax: 14,
              payOutMin: 0.2,
              payOutMax: 2,
            },
            {
              currencyId: 2,
              currency: 'KZT',
              payInMin: 3,
              payInMax: 3,
              payOutMin: 1,
              payOutMax: 1,
            },
          ],
        },
        {
          id: SECOND_TRADER,
          login: 'trader2_tg',
          rates: [
            {
              currencyId: 1,
              currency: 'RUB',
              payInMin: 1,
              payInMax: 1,
              payOutMin: 0.1,
              payOutMax: 0.1,
            },
          ],
        },
      ]);
    });

    it('gives a trader its leads', async () => {
      const referrals = await controller.referrals(TRADER);

      expect(team.assignmentsOf).toHaveBeenCalledWith(TRADER);
      expect(team.assignmentsLedBy).not.toHaveBeenCalled();
      expect(referrals).toEqual([
        {
          id: LEAD,
          login: 'lead_tg',
          rates: [
            {
              currencyId: 1,
              currency: 'RUB',
              payInMin: 2.5,
              payInMax: 2.5,
              payOutMin: 0.5,
              payOutMax: 0.5,
            },
          ],
        },
      ]);
    });

    it('gives a trader with no lead an empty list', async () => {
      team.assignmentsOf.mockResolvedValue([]);

      await expect(controller.referrals(TRADER)).resolves.toEqual([]);
    });

    it.each(
      Object.values(Role).filter(
        (role) => role !== Role.Trader && role !== Role.LeadTrader,
      ),
    )('gives a %s an empty list without asking anything', async (role) => {
      users.set(TRADER, account({ role }));

      await expect(controller.referrals(TRADER)).resolves.toEqual([]);
      expect(team.assignmentsOf).not.toHaveBeenCalled();
      expect(team.assignmentsLedBy).not.toHaveBeenCalled();
      expect(rates.getLeadSet).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown user', async () => {
      await expect(controller.referrals(uuidOf(99))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
