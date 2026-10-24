import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In, QueryFailedError } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderLead } from '../entities/trader-lead.entity';
import { User } from '../entities/user.entity';
import { UserTeamService } from '../services/user-team.service';
import { LeadAssignment } from '../types/lead-assignment';

describe('UserTeamService', () => {
  const TRADER = uuidOf(1);
  const LEAD = uuidOf(2);
  const ACTOR = uuidOf(9);
  const RUB = 1;
  const KZT = 2;

  const assignment = (
    overrides: Partial<LeadAssignment> = {},
  ): LeadAssignment => ({
    leadUserId: LEAD,
    currencyId: RUB,
    payInPercent: 2.5,
    payOutPercent: 0.5,
    ...overrides,
  });

  const account = (overrides: Partial<User> = {}): User =>
    ({
      id: TRADER,
      email: 'trader@example.com',
      telegramUsername: null,
      role: Role.Trader,
      ...overrides,
    }) as User;

  let accounts: Map<string, User>;
  let links: { findOne: jest.Mock; find: jest.Mock };
  let manager: {
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    find: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let directory: { findById: jest.Mock };
  let audit: { record: jest.Mock };
  let currencies: { findByIds: jest.Mock };
  let service: UserTeamService;

  beforeEach(() => {
    accounts = new Map([
      [TRADER, account()],
      [
        LEAD,
        account({ id: LEAD, email: 'lead@example.com', role: Role.LeadTrader }),
      ],
    ]);
    links = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
    };
    manager = {
      create: jest.fn((_entity, data) => data),
      merge: jest.fn((_entity, target, data) => Object.assign(target, data)),
      save: jest.fn(async (row) => ({ id: 1, ...row })),
      delete: jest.fn(),
      find: jest.fn(async () => []),
    };
    dataSource = { transaction: jest.fn(async (work) => work(manager)) };
    directory = {
      findById: jest.fn(async (id: string) => accounts.get(id) ?? null),
    };
    audit = { record: jest.fn() };
    currencies = {
      findByIds: jest.fn(async (ids: number[]) =>
        ids.filter((id) => [RUB, KZT].includes(id)).map((id) => ({ id })),
      ),
    };
    service = new UserTeamService(
      links as never,
      dataSource as never,
      directory as never,
      audit as never,
      currencies as never,
    );
  });

  describe('addLead', () => {
    it('answers 409 when a concurrent request wrote the same link first', async () => {
      dataSource.transaction.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], { code: '23505' } as never),
      );

      await expect(
        service.addLead(TRADER, assignment(), ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets any other database failure through untouched', async () => {
      const failure = new QueryFailedError('INSERT', [], {
        code: '23503',
      } as never);

      dataSource.transaction.mockRejectedValueOnce(failure);

      await expect(service.addLead(TRADER, assignment(), ACTOR)).rejects.toBe(
        failure,
      );
    });

    it('saves the link and its audit row in one transaction', async () => {
      await service.addLead(TRADER, assignment(), ACTOR);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      const row = {
        traderUserId: TRADER,
        leadUserId: LEAD,
        currencyId: RUB,
        payInPercent: 2.5,
        payOutPercent: 0.5,
      };

      expect(manager.create).toHaveBeenCalledWith(TraderLead, row);
      expect(manager.save).toHaveBeenCalledWith(row);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ACTOR,
          targetUserId: TRADER,
          action: 'user.lead_added',
          metadata: {
            leadUserId: LEAD,
            currencyId: RUB,
            payInPercent: 2.5,
            payOutPercent: 0.5,
          },
        },
        manager,
      );
    });

    it('answers not found for a trader that does not exist', async () => {
      accounts.delete(TRADER);

      await expect(
        service.addLead(TRADER, assignment(), ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each(Object.values(Role).filter((role) => role !== Role.Trader))(
      'refuses to give a %s a lead',
      async (role) => {
        accounts.set(TRADER, account({ role }));

        await expect(
          service.addLead(TRADER, assignment(), ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('answers a bad request for a lead that does not exist', async () => {
      accounts.delete(LEAD);

      await expect(
        service.addLead(TRADER, assignment(), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each(Object.values(Role).filter((role) => role !== Role.LeadTrader))(
      'refuses a %s as the lead',
      async (role) => {
        accounts.set(LEAD, account({ id: LEAD, role }));

        await expect(
          service.addLead(TRADER, assignment(), ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('answers a bad request for a currency that does not exist', async () => {
      await expect(
        service.addLead(TRADER, assignment({ currencyId: 99 }), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses a link that already exists', async () => {
      links.findOne.mockResolvedValue({
        id: 1,
        traderUserId: TRADER,
        leadUserId: LEAD,
      });

      await expect(
        service.addLead(TRADER, assignment(), ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(links.findOne).toHaveBeenCalledWith({
        where: { traderUserId: TRADER, leadUserId: LEAD, currencyId: RUB },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('writes no audit row when the link cannot be saved', async () => {
      manager.save.mockRejectedValue(new Error('unique violation'));

      await expect(
        service.addLead(TRADER, assignment(), ACTOR),
      ).rejects.toThrow('unique violation');
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('removeLead', () => {
    it('deletes the lead in every currency and audits it in one transaction', async () => {
      links.find.mockResolvedValue([
        { id: 4, traderUserId: TRADER, leadUserId: LEAD, currencyId: RUB },
        { id: 5, traderUserId: TRADER, leadUserId: LEAD, currencyId: KZT },
      ]);

      await service.removeLead(TRADER, LEAD, ACTOR);

      expect(links.find).toHaveBeenCalledWith({
        where: { traderUserId: TRADER, leadUserId: LEAD },
      });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledWith(TraderLead, {
        id: In([4, 5]),
      });
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ACTOR,
          targetUserId: TRADER,
          action: 'user.lead_removed',
          metadata: { leadUserId: LEAD },
        },
        manager,
      );
    });

    it('answers not found for a link that does not exist', async () => {
      await expect(
        service.removeLead(TRADER, LEAD, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('replaceLeads', () => {
    const existingLink = (overrides: Partial<TraderLead> = {}): TraderLead =>
      ({
        id: 10,
        traderUserId: TRADER,
        leadUserId: LEAD,
        currencyId: RUB,
        payInPercent: 1,
        payOutPercent: 0.1,
        ...overrides,
      }) as TraderLead;

    it('updates a kept row in place, inserts a new one and deletes a dropped one, with the audit in the same transaction', async () => {
      const kept = existingLink();
      manager.find.mockResolvedValue([
        kept,
        existingLink({ id: 11, currencyId: KZT }),
      ]);
      const second = uuidOf(3);
      accounts.set(
        second,
        account({
          id: second,
          email: 'lead2@example.com',
          role: Role.LeadTrader,
        }),
      );

      await service.replaceLeads(
        TRADER,
        [assignment(), assignment({ leadUserId: second, payInPercent: 1 })],
        ACTOR,
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.find).toHaveBeenCalledWith(TraderLead, {
        where: { traderUserId: TRADER },
      });
      expect(manager.delete).toHaveBeenCalledWith(TraderLead, { id: In([11]) });
      expect(manager.merge).toHaveBeenCalledWith(
        TraderLead,
        kept,
        expect.objectContaining({ payInPercent: 2.5, payOutPercent: 0.5 }),
      );
      const [saved] = manager.save.mock.calls[0] as [TraderLead[]];
      expect(saved).toHaveLength(2);
      expect(saved[0]).toBe(kept);
      expect(saved[0].id).toBe(10);
      expect(saved[1]).toEqual({
        traderUserId: TRADER,
        leadUserId: second,
        currencyId: RUB,
        payInPercent: 1,
        payOutPercent: 0.5,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: ACTOR,
          targetUserId: TRADER,
          action: 'user.leads_replaced',
        }),
        manager,
      );
    });

    it('keeps a kept row id, so its detailed rates survive the save', async () => {
      manager.find.mockResolvedValue([existingLink()]);

      await service.replaceLeads(TRADER, [assignment()], ACTOR);

      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('lets one lead lead the trader in two currencies', async () => {
      await service.replaceLeads(
        TRADER,
        [assignment(), assignment({ currencyId: KZT })],
        ACTOR,
      );

      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('takes an empty set as removing every lead', async () => {
      manager.find.mockResolvedValue([existingLink()]);

      await service.replaceLeads(TRADER, [], ACTOR);

      expect(manager.delete).toHaveBeenCalledWith(TraderLead, { id: In([10]) });
      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledTimes(1);
    });

    it('answers 400 to the same lead twice in one currency', async () => {
      await expect(
        service.replaceLeads(
          TRADER,
          [assignment(), assignment({ payInPercent: 1 })],
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('answers 404 for a trader that does not exist', async () => {
      accounts.delete(TRADER);

      await expect(
        service.replaceLeads(TRADER, [assignment()], ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(Object.values(Role).filter((role) => role !== Role.Trader))(
      'answers 400 for a %s as the trader',
      async (role) => {
        accounts.set(TRADER, account({ role }));

        await expect(
          service.replaceLeads(TRADER, [assignment()], ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it.each(Object.values(Role).filter((role) => role !== Role.LeadTrader))(
      'answers 400 for a %s as a lead',
      async (role) => {
        accounts.set(LEAD, account({ id: LEAD, role }));

        await expect(
          service.replaceLeads(TRADER, [assignment()], ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('answers 400 for a lead nobody holds and for a currency that does not exist', async () => {
      await expect(
        service.replaceLeads(
          TRADER,
          [assignment({ leadUserId: uuidOf(40) })],
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.replaceLeads(TRADER, [assignment({ currencyId: 99 })], ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('answers 409 when a concurrent save wrote the same row first', async () => {
      dataSource.transaction.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], { code: '23505' } as never),
      );

      await expect(
        service.replaceLeads(TRADER, [assignment()], ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers with the set as stored, lead and currency loaded', async () => {
      const stored = [existingLink()];
      links.find.mockResolvedValue(stored);

      await expect(
        service.replaceLeads(TRADER, [assignment()], ACTOR),
      ).resolves.toBe(stored);
      expect(links.find).toHaveBeenCalledWith({
        where: { traderUserId: TRADER },
        relations: { lead: true, currency: true },
        order: { id: 'ASC' },
      });
    });
  });

  describe('leadsOf', () => {
    it('names a lead once even when it leads the trader in two currencies', async () => {
      links.find.mockResolvedValue([
        {
          traderUserId: TRADER,
          currencyId: RUB,
          lead: account({ id: LEAD, email: 'lead@example.com' }),
        },
        {
          traderUserId: TRADER,
          currencyId: KZT,
          lead: account({ id: LEAD, email: 'lead@example.com' }),
        },
      ]);

      const leads = await service.leadsOf([TRADER]);

      expect(leads.get(TRADER)).toEqual([
        { id: LEAD, login: 'lead@example.com' },
      ]);
    });

    it('reads every link of the page in one query, lead loaded', async () => {
      links.find.mockResolvedValue([
        {
          traderUserId: TRADER,
          lead: account({ id: LEAD, email: 'lead@example.com' }),
        },
        {
          traderUserId: TRADER,
          lead: account({
            id: uuidOf(3),
            email: null,
            telegramUsername: 'lead_tg',
          }),
        },
        {
          traderUserId: uuidOf(5),
          lead: account({ id: LEAD, email: 'lead@example.com' }),
        },
      ]);

      const leads = await service.leadsOf([TRADER, uuidOf(5), uuidOf(6)]);

      expect(links.find).toHaveBeenCalledTimes(1);
      expect(links.find).toHaveBeenCalledWith({
        where: { traderUserId: In([TRADER, uuidOf(5), uuidOf(6)]) },
        relations: { lead: true },
        order: { id: 'ASC' },
      });
      expect(leads.get(TRADER)).toEqual([
        { id: LEAD, login: 'lead@example.com' },
        { id: uuidOf(3), login: 'lead_tg' },
      ]);
      expect(leads.get(uuidOf(5))).toEqual([
        { id: LEAD, login: 'lead@example.com' },
      ]);
      expect(leads.has(uuidOf(6))).toBe(false);
    });

    it('asks nothing for an empty list', async () => {
      await expect(service.leadsOf([])).resolves.toEqual(new Map());
      expect(links.find).not.toHaveBeenCalled();
    });
  });

  it('names a member holding both identifiers by the telegram username', async () => {
    links.find.mockResolvedValue([
      {
        traderUserId: TRADER,
        lead: account({
          id: LEAD,
          email: 'lead@example.com',
          telegramUsername: 'lead_tg',
        }),
      },
    ]);

    const leads = await service.leadsOf([TRADER]);

    expect(leads.get(TRADER)).toEqual([{ id: LEAD, login: 'lead_tg' }]);
  });

  describe('subordinatesOf', () => {
    it('reads every link of the page in one query, trader loaded', async () => {
      links.find.mockResolvedValue([{ leadUserId: LEAD, trader: account() }]);

      const subordinates = await service.subordinatesOf([LEAD]);

      expect(links.find).toHaveBeenCalledTimes(1);
      expect(links.find).toHaveBeenCalledWith({
        where: { leadUserId: In([LEAD]) },
        relations: { trader: true },
        order: { id: 'ASC' },
      });
      expect(subordinates.get(LEAD)).toEqual([
        { id: TRADER, login: 'trader@example.com' },
      ]);
    });

    it('asks nothing for an empty list', async () => {
      await expect(service.subordinatesOf([])).resolves.toEqual(new Map());
      expect(links.find).not.toHaveBeenCalled();
    });
  });
});
