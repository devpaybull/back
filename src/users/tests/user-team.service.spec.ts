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

describe('UserTeamService', () => {
  const TRADER = uuidOf(1);
  const LEAD = uuidOf(2);
  const ACTOR = uuidOf(9);

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
  let manager: { create: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let directory: { findById: jest.Mock };
  let audit: { record: jest.Mock };
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
      save: jest.fn(async (row) => ({ id: 1, ...row })),
      delete: jest.fn(),
    };
    dataSource = { transaction: jest.fn(async (work) => work(manager)) };
    directory = {
      findById: jest.fn(async (id: string) => accounts.get(id) ?? null),
    };
    audit = { record: jest.fn() };
    service = new UserTeamService(
      links as never,
      dataSource as never,
      directory as never,
      audit as never,
    );
  });

  describe('addLead', () => {
    it('answers 409 when a concurrent request wrote the same link first', async () => {
      dataSource.transaction.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], { code: '23505' } as never),
      );

      await expect(service.addLead(TRADER, LEAD, ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('lets any other database failure through untouched', async () => {
      const failure = new QueryFailedError('INSERT', [], {
        code: '23503',
      } as never);

      dataSource.transaction.mockRejectedValueOnce(failure);

      await expect(service.addLead(TRADER, LEAD, ACTOR)).rejects.toBe(failure);
    });

    it('saves the link and its audit row in one transaction', async () => {
      await service.addLead(TRADER, LEAD, ACTOR);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(TraderLead, {
        traderUserId: TRADER,
        leadUserId: LEAD,
      });
      expect(manager.save).toHaveBeenCalledWith({
        traderUserId: TRADER,
        leadUserId: LEAD,
      });
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ACTOR,
          targetUserId: TRADER,
          action: 'user.lead_added',
          metadata: { leadUserId: LEAD },
        },
        manager,
      );
    });

    it('answers not found for a trader that does not exist', async () => {
      accounts.delete(TRADER);

      await expect(service.addLead(TRADER, LEAD, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each(Object.values(Role).filter((role) => role !== Role.Trader))(
      'refuses to give a %s a lead',
      async (role) => {
        accounts.set(TRADER, account({ role }));

        await expect(
          service.addLead(TRADER, LEAD, ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('answers a bad request for a lead that does not exist', async () => {
      accounts.delete(LEAD);

      await expect(service.addLead(TRADER, LEAD, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each(Object.values(Role).filter((role) => role !== Role.LeadTrader))(
      'refuses a %s as the lead',
      async (role) => {
        accounts.set(LEAD, account({ id: LEAD, role }));

        await expect(
          service.addLead(TRADER, LEAD, ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('refuses a link that already exists', async () => {
      links.findOne.mockResolvedValue({
        id: 1,
        traderUserId: TRADER,
        leadUserId: LEAD,
      });

      await expect(service.addLead(TRADER, LEAD, ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(links.findOne).toHaveBeenCalledWith({
        where: { traderUserId: TRADER, leadUserId: LEAD },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('writes no audit row when the link cannot be saved', async () => {
      manager.save.mockRejectedValue(new Error('unique violation'));

      await expect(service.addLead(TRADER, LEAD, ACTOR)).rejects.toThrow(
        'unique violation',
      );
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('removeLead', () => {
    it('deletes the link and audits it in one transaction', async () => {
      links.findOne.mockResolvedValue({
        id: 4,
        traderUserId: TRADER,
        leadUserId: LEAD,
      });

      await service.removeLead(TRADER, LEAD, ACTOR);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledWith(TraderLead, { id: 4 });
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

  describe('leadsOf', () => {
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
