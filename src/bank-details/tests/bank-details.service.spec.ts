import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { toFiat } from '../../common/utils/to-fiat';
import { toPage } from '../../common/types/page';
import { AuditService } from '../../audit/services/audit.service';
import { ActivityAction } from '../../audit/types/activity-action.enum';
import { BanksService } from '../../banks/banks.service';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { DevicesService } from '../../devices/devices.service';
import { MobileOperatorsService } from '../../mobile-operators/mobile-operators.service';
import { BankDetailsType } from '../types/bank-details-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { CounterpartiesService } from '../../counterparties/services/counterparties.service';
import { CounterpartyBindingType } from '../../counterparties/types/counterparty-binding-type.enum';
import { RequisiteEventReason } from '../../counterparties/types/requisite-event-reason.enum';
import { BankDetailsService } from '../bank-details.service';
import { BankDetails } from '../entities/bank-details.entity';
import { BankDetailTagLink } from '../entities/bank-detail-tag-link.entity';
import { BankDetailTag } from '../entities/bank-detail-tag.entity';
import { ActivityReadsService } from '../../audit/services/activity-reads.service';
import { BankDetailsAction } from '../types/bank-details-action.enum';
import { BankDetailsSortField } from '../types/bank-details-sort-field';

describe('BankDetailsService', () => {
  const owner = uuidOf(1);
  const stranger = uuidOf(2);
  const admin = uuidOf(3);

  let stored: BankDetails[];
  let service: BankDetailsService;

  let links: { bankDetailsId: string; tagId: number }[];

  const tagLinks = {
    delete: jest.fn(async ({ bankDetailsId }: { bankDetailsId: string }) => {
      links = links.filter((link) => link.bankDetailsId !== bankDetailsId);
    }),
    create: jest.fn((link: { bankDetailsId: string; tagId: number }) => link),
    save: jest.fn(async (rows: { bankDetailsId: string; tagId: number }[]) => {
      links.push(...rows);

      return rows;
    }),
  };

  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === BankDetailTagLink ? tagLinks : bankDetails,
    ),
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) => {
      const snapshot = stored.map((row) => ({ ...row }));

      try {
        return await work(manager);
      } catch (error) {
        stored = snapshot;
        throw error;
      }
    }),
  };

  const audit = {
    record: jest.fn<Promise<undefined>, [Record<string, unknown>, unknown?]>(
      async () => undefined,
    ),
  };

  const bankDetails = {
    manager,
    findOne: jest.fn(
      async ({ where }: { where: Partial<BankDetails> }) =>
        stored.find((row) =>
          Object.entries(where).every(([field, value]) => row[field] === value),
        ) ?? null,
    ),
    findAndCount: jest.fn(async () => [stored, stored.length]),
    count: jest.fn(
      async ({ where }: { where: Partial<BankDetails> }) =>
        stored.filter((row) =>
          Object.entries(where).every(([field, value]) => row[field] === value),
        ).length,
    ),
    find: jest.fn(
      async (options: {
        where: { id?: { value: string[] } } & Record<string, unknown>;
      }) =>
        options.where.id
          ? stored.filter((row) => options.where.id.value.includes(row.id))
          : stored.filter((row) =>
              Object.entries(options.where).every(
                ([field, value]) => row[field] === value,
              ),
            ),
    ),
    create: jest.fn(
      (data: Partial<BankDetails>) => ({ ...data }) as BankDetails,
    ),
    merge: jest.fn((target: BankDetails, patch: Partial<BankDetails>) =>
      Object.assign(target, patch),
    ),
    softDelete: jest.fn(async (id: string) => {
      const row = stored.find((held) => held.id === id);

      if (row) row.deletedAt = new Date();

      return { affected: row ? 1 : 0 };
    }),
    update: jest.fn(
      async (where: Partial<BankDetails>, patch: Partial<BankDetails>) => {
        const touched = stored.filter((row) =>
          Object.entries(where).every(([field, value]) => row[field] === value),
        );
        touched.forEach((row) => Object.assign(row, patch));

        return { affected: touched.length };
      },
    ),
    save: jest.fn(async (row: BankDetails) => {
      if (stored.includes(row)) return row;

      const saved = { ...row, id: row.id ?? uuidOf(stored.length + 10) };
      stored.push(saved);

      return saved;
    }),
  };

  const counterparties = {
    unbindRequisiteWithin: jest.fn(async () => undefined),
    bindWithin: jest.fn(async () => ({ id: 1 })),
    replaceWithin: jest.fn(async () => ({ id: 1 })),
  };

  const tags = {
    find: jest.fn(
      async ({
        where,
      }: {
        where: { id: { value: number[] }; userId: string };
      }) =>
        where.userId === owner
          ? where.id.value.filter((id) => id < 100).map((id) => ({ id }))
          : [],
    ),
    findOne: jest.fn(),
    create: jest.fn((data: Record<string, unknown>) => data),
    save: jest.fn(async (data: Record<string, unknown>) => ({
      id: 7,
      ...data,
    })),
    delete: jest.fn(async () => undefined),
    findAndCount: jest.fn(async () => [[], 0]),
  };

  const reads = {
    lastReadAt: jest.fn(async (): Promise<Date | null> => null),
    markRead: jest.fn(async (_u: string, _s: string, at: Date) => at),
  };

  const banks = { findById: jest.fn(async () => ({ id: 1 })) };

  const mobileOperators = { findById: jest.fn(async () => ({ id: 4 })) };

  const config = { get: jest.fn(() => 5000) };

  const devices = {
    findOwn: jest.fn(async () => ({ id: 7 })),
    findById: jest.fn(async () => ({ id: 7 })),
    delete: jest.fn(async () => undefined),
  };

  const activity = () =>
    audit.record.mock.calls.map(([entry]) => entry as Record<string, unknown>);

  const card = (overrides: Partial<BankDetails> = {}): BankDetails =>
    ({
      id: uuidOf(100),
      userId: owner,
      bankId: 1,
      type: BankDetailsType.CardOrSbp,
      cardholderName: null,
      card: '4400430212345678',
      phone: null,
      bank: { id: 1, name: 'Sber' },
      minAmountEnabled: false,
      minAmount: null,
      maxAmountEnabled: false,
      maxAmount: null,
      dailyLimitEnabled: false,
      dailyLimit: null,
      monthlyLimitEnabled: false,
      monthlyLimit: null,
      dailyAmountLimitEnabled: true,
      dailyAmountLimit: toFiat(300000),
      monthlyAmountLimitEnabled: false,
      monthlyAmountLimit: null,
      maxActiveTransactionsEnabled: false,
      maxActiveTransactions: null,
      delayBetweenRequestsEnabled: false,
      delayBetweenRequests: null,
      counterpartyOnly: false,
      reserve: false,
      active: true,
      bannedAt: null,
      bannedByUserId: null,
      createdAt: new Date(),
      maxCounterparties: overrides.counterpartyOnly ? 8 : null,
      ...overrides,
    }) as BankDetails;

  beforeEach(async () => {
    jest.clearAllMocks();
    banks.findById.mockResolvedValue({ id: 1 });
    mobileOperators.findById.mockResolvedValue({ id: 4 });
    devices.findOwn.mockResolvedValue({ id: 7 });
    devices.findById.mockResolvedValue({ id: 7 });
    stored = [card()];
    links = [];
    audit.record.mockResolvedValue(undefined);
    reads.lastReadAt.mockResolvedValue(null);

    const module = await Test.createTestingModule({
      providers: [
        BankDetailsService,
        { provide: getRepositoryToken(BankDetails), useValue: bankDetails },
        { provide: BanksService, useValue: banks },
        { provide: DevicesService, useValue: devices },
        { provide: MobileOperatorsService, useValue: mobileOperators },
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: config },
        { provide: CounterpartiesService, useValue: counterparties },
        { provide: getRepositoryToken(BankDetailTag), useValue: tags },
        { provide: ActivityReadsService, useValue: reads },
      ],
    }).compile();

    service = module.get(BankDetailsService);
  });

  describe('create', () => {
    it('writes a bank_details_added row for the owner, in the creating transaction', async () => {
      const created = await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '2204321033002239',
        cardholderName: 'IVAN IVANOV',
      });

      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: owner,
          impersonatorUserId: null,
          targetUserId: owner,
          action: ActivityAction.BankDetailsAdded,
          metadata: {
            id: created.id,
            type: BankDetailsType.CardOrSbp,
            card: '2204321033002239',
            phone: null,
            cardholderName: 'IVAN IVANOV',
            bankId: 1,
            bankName: null,
            mobileOperatorId: null,
            mobileOperatorName: null,
          },
        },
        manager,
      );
    });

    it('names the superadmin of a login-link session beside the trader', async () => {
      await service.create(
        {
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          bankId: 1,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
        },
        uuidOf(5),
      );

      expect(activity()[0]).toMatchObject({
        actorUserId: owner,
        impersonatorUserId: uuidOf(5),
      });
    });

    it('keeps the phone in the row of an sbp requisite', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        phone: '+79991234567',
      });

      expect(activity()[0].metadata).toMatchObject({
        phone: '+79991234567',
        card: null,
      });
    });

    it('rolls the requisite back when the audit row cannot be written', async () => {
      audit.record.mockRejectedValue(new Error('audit down'));

      await expect(
        service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          bankId: 1,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
        }),
      ).rejects.toThrow('audit down');
      expect(stored).toHaveLength(1);
    });

    it('writes no activity row when the bank does not exist', async () => {
      banks.findById.mockResolvedValue(null);

      await expect(
        service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          bankId: 9,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('stores the details against the owner it was told', async () => {
      await service.create({
        userId: stranger,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        phone: '+79991234567',
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: stranger, phone: '+79991234567' }),
      );
    });

    it('keeps the card whole, digits and all', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '0000430212345678',
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ card: '0000430212345678' }),
      );
    });

    it('writes the absent optional fields as null', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '4400430212345678',
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cardholderName: null,
          phone: null,
          mobileOperatorId: null,
          minAmount: null,
          maxAmount: null,
          dailyLimit: null,
          monthlyLimit: null,
          monthlyAmountLimit: null,
          hourlyAmountLimit: null,
          maxActiveTransactions: null,
          delayBetweenRequests: null,
          maxCounterparties: null,
        }),
      );
    });

    it('starts every toggle off but the daily turnover, and the standing flags with it', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '4400430212345678',
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountEnabled: false,
          maxAmountEnabled: false,
          dailyLimitEnabled: false,
          monthlyLimitEnabled: false,
          dailyAmountLimitEnabled: true,
          monthlyAmountLimitEnabled: false,
          hourlyAmountLimitEnabled: false,
          maxActiveTransactionsEnabled: false,
          delayBetweenRequestsEnabled: false,
          counterpartyOnly: false,
          sameBankOnly: false,
          reserve: false,
        }),
      );
    });

    it('drops a limit whose toggle was not switched on', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '4400430212345678',
        minAmount: toFiat(500),
        dailyLimit: 40,
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ minAmount: null, dailyLimit: null }),
      );
    });

    it('keeps a limit whose toggle came with it', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '4400430212345678',
        minAmountEnabled: true,
        minAmount: toFiat(500),
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountEnabled: true,
          minAmount: toFiat(500),
        }),
      );
    });

    it('lets the column default stand when active is absent', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '4400430212345678',
      });

      const [data] = bankDetails.create.mock.calls[0] as [Partial<BankDetails>];

      expect(data).not.toHaveProperty('active');
    });

    it('refuses a bank that does not exist', async () => {
      banks.findById.mockResolvedValue(null);

      await expect(
        service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          bankId: 9,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(bankDetails.save).not.toHaveBeenCalled();
    });

    it('puts no ceiling on how many one account may hold', async () => {
      for (let n = 0; n < 5; n += 1) {
        await service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          bankId: 1,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
        });
      }

      expect(stored).toHaveLength(6);
    });
  });

  describe('binding a device', () => {
    it('binds a device the trader owns', async () => {
      await service.create({
        userId: owner,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '4400430212345678',
        deviceId: 7,
      });

      expect(devices.findOwn).toHaveBeenCalledWith(7, owner);
      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 7 }),
      );
    });

    it('refuses a device that belongs to somebody else, asking the owner-scoped finder', async () => {
      devices.findOwn.mockResolvedValue(null);

      await expect(
        service.create({
          userId: owner,
          dailyAmountLimit: toFiat(300000),
          bankId: 1,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
          deviceId: 7,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(bankDetails.save).not.toHaveBeenCalled();
    });

    it('checks the device against the owner of the row, not the row being moved', async () => {
      await service.updateOwn(uuidOf(100), owner, { deviceId: 7 });

      expect(devices.findOwn).toHaveBeenCalledWith(7, owner);
    });

    it('refuses a patch that points at a device the trader does not own', async () => {
      devices.findOwn.mockResolvedValue(null);

      await expect(
        service.updateOwn(uuidOf(100), owner, { deviceId: 7 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('asks nothing of the devices when a patch names none', async () => {
      await service.updateOwn(uuidOf(100), owner, { reserve: true });

      expect(devices.findOwn).not.toHaveBeenCalled();
    });
  });

  describe('deleting', () => {
    it('soft-deletes the row rather than erasing it', async () => {
      await service.deleteOwn(uuidOf(100), owner);

      expect(bankDetails.softDelete).toHaveBeenCalledWith(uuidOf(100));
      expect(stored[0].deletedAt).toBeInstanceOf(Date);
      expect(stored[0].card).toBe('4400430212345678');
    });

    it('writes a bank_details_deleted row, actor the owner, with the number and the bank', async () => {
      await service.deleteOwn(uuidOf(100), owner);

      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: owner,
          impersonatorUserId: null,
          targetUserId: owner,
          action: ActivityAction.BankDetailsDeleted,
          metadata: {
            id: uuidOf(100),
            type: BankDetailsType.CardOrSbp,
            card: '4400430212345678',
            phone: null,
            cardholderName: null,
            bankId: 1,
            bankName: 'Sber',
            mobileOperatorId: null,
            mobileOperatorName: null,
          },
        },
        manager,
      );
    });

    it('names the superadmin of a login-link session on a delete', async () => {
      await service.deleteOwn(uuidOf(100), owner, uuidOf(5));

      expect(activity()[0]).toMatchObject({
        actorUserId: owner,
        impersonatorUserId: uuidOf(5),
      });
    });

    it('rolls the delete back when the audit row cannot be written', async () => {
      audit.record.mockRejectedValue(new Error('audit down'));

      await expect(service.deleteOwn(uuidOf(100), owner)).rejects.toThrow(
        'audit down',
      );
      expect(stored[0].deletedAt).toBeUndefined();
    });

    it('records the administrator as the actor and the owner as the target', async () => {
      await service.delete(uuidOf(100), admin);

      expect(activity()).toEqual([
        expect.objectContaining({
          actorUserId: admin,
          targetUserId: owner,
          action: ActivityAction.BankDetailsDeleted,
        }),
      ]);
    });

    it('writes no row when the delete is refused', async () => {
      await expect(service.deleteOwn(uuidOf(100), stranger)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.delete(uuidOf(404), admin)).rejects.toThrow(
        NotFoundException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers 404 when the row belongs to somebody else, and deletes nothing', async () => {
      await expect(service.deleteOwn(uuidOf(100), stranger)).rejects.toThrow(
        NotFoundException,
      );
      expect(bankDetails.softDelete).not.toHaveBeenCalled();
    });

    it('answers 404 for an id nobody holds', async () => {
      await expect(service.deleteOwn(uuidOf(404), owner)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets an administrator delete any row, without an owner to match', async () => {
      await service.delete(uuidOf(100), admin);

      expect(bankDetails.softDelete).toHaveBeenCalledWith(uuidOf(100));
    });

    it('still answers 404 to an administrator for an id nobody holds', async () => {
      await expect(service.delete(uuidOf(404), admin)).rejects.toThrow(
        NotFoundException,
      );
      expect(bankDetails.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('deleting a device', () => {
    it('switches the device’s requisites off and keeps them pointing at it, then deletes the device', async () => {
      stored = [card({ deviceId: 7 }), card({ id: uuidOf(101), deviceId: 8 })];

      await service.deleteDevice(7, admin);

      expect(stored[0]).toMatchObject({ deviceId: 7, active: false });
      expect(stored[1]).toMatchObject({ deviceId: 8, active: true });
      expect(devices.delete).toHaveBeenCalledWith(7, admin, manager, null);
      expect(activity()).toEqual([
        expect.objectContaining({
          actorUserId: admin,
          targetUserId: owner,
          action: BankDetailsAction.Disabled,
          metadata: expect.objectContaining({
            id: uuidOf(100),
            reason: 'device_deleted',
            deviceId: 7,
          }),
        }),
      ]);
    });

    it('checks the owner through the owner-scoped finder', async () => {
      await service.deleteOwnDevice(7, owner);

      expect(devices.findOwn).toHaveBeenCalledWith(7, owner);
      expect(devices.delete).toHaveBeenCalledWith(7, owner, manager, null);
    });

    it('passes the superadmin of a login-link session on to the device delete', async () => {
      await service.deleteOwnDevice(7, owner, uuidOf(5));

      expect(devices.delete).toHaveBeenCalledWith(7, owner, manager, uuidOf(5));
    });

    it('switches off inside the same transaction as the device delete, so a failure restores the requisite', async () => {
      stored = [card({ deviceId: 7 })];
      devices.delete.mockRejectedValueOnce(new Error('device down'));

      await expect(service.deleteDevice(7, admin)).rejects.toThrow(
        'device down',
      );
      expect(stored[0].active).toBe(true);
    });

    it('answers 409 to enabling a requisite whose device is deleted', async () => {
      stored = [card({ deviceId: 7, active: false })];
      devices.findOwn.mockResolvedValue(null);

      await expect(
        service.updateOwn(uuidOf(100), owner, { active: true }),
      ).rejects.toThrow(ConflictException);
      expect(stored[0].active).toBe(false);
    });

    it('answers 409 to an administrator enabling it too', async () => {
      stored = [card({ deviceId: 7, active: false })];
      devices.findById.mockResolvedValue(null);

      await expect(
        service.supervise(uuidOf(100), { active: true }, admin),
      ).rejects.toThrow(ConflictException);
    });

    it('brings it back through a patch to another live device of the owner', async () => {
      stored = [card({ deviceId: 7, active: false })];

      await service.updateOwn(uuidOf(100), owner, { deviceId: 9 });

      expect(devices.findOwn).toHaveBeenCalledWith(9, owner);
      expect(stored[0].deviceId).toBe(9);
    });

    it('answers 404 when the device belongs to somebody else, and touches nothing', async () => {
      devices.findOwn.mockResolvedValue(null);

      await expect(service.deleteOwnDevice(7, stranger)).rejects.toThrow(
        NotFoundException,
      );
      expect(bankDetails.update).not.toHaveBeenCalled();
      expect(devices.delete).not.toHaveBeenCalled();
    });
  });

  describe('the counterparty-only floor', () => {
    it('reads the configured floor rather than inventing one', () => {
      expect(service.counterpartyMinAmount).toEqual(toFiat(5000));
      expect(config.get).toHaveBeenCalledWith('COUNTERPARTY_MIN_AMOUNT');
    });

    it('turns the minimum on and leaves the column empty, since the floor lives in config', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '4400430212345678',
        counterpartyOnly: true,
        maxCounterparties: 8,
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          counterpartyOnly: true,
          maxCounterparties: 8,
          minAmountEnabled: true,
          minAmount: null,
        }),
      );
    });

    it('answers 409 when a creation tries to set the minimum itself', async () => {
      await expect(
        service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          bankId: 1,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
          counterpartyOnly: true,
          maxCounterparties: 8,
          minAmount: toFiat(100),
        }),
      ).rejects.toThrow(ConflictException);
      expect(bankDetails.save).not.toHaveBeenCalled();
    });

    it('answers 409 when a creation tries to switch the minimum off', async () => {
      await expect(
        service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          bankId: 1,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
          counterpartyOnly: true,
          maxCounterparties: 8,
          minAmountEnabled: false,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('answers 409 when a patch sets the minimum on a row already counterparty-only', async () => {
      stored = [card({ counterpartyOnly: true, minAmountEnabled: true })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { minAmount: toFiat(100) }),
      ).rejects.toThrow(ConflictException);
    });

    it('answers 409 when one patch turns the flag on and sets the minimum together', async () => {
      await expect(
        service.updateOwn(uuidOf(100), owner, {
          counterpartyOnly: true,
          maxCounterparties: 8,
          minAmount: toFiat(100),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('clears the trader’s own minimum when the flag goes on', async () => {
      stored = [card({ minAmountEnabled: true, minAmount: toFiat(700) })];

      await expect(
        service.updateOwn(uuidOf(100), owner, {
          counterpartyOnly: true,
          maxCounterparties: 8,
        }),
      ).resolves.toMatchObject({ minAmountEnabled: true, minAmount: null });
    });

    it('puts the minimum out altogether when the flag goes off', async () => {
      stored = [card({ counterpartyOnly: true, minAmountEnabled: true })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { counterpartyOnly: false }),
      ).resolves.toMatchObject({
        counterpartyOnly: false,
        minAmountEnabled: false,
        minAmount: null,
      });
    });

    it('lets the minimum be set again once the flag is off', async () => {
      stored = [card({ counterpartyOnly: false })];

      await expect(
        service.updateOwn(uuidOf(100), owner, {
          minAmountEnabled: true,
          minAmount: toFiat(700),
        }),
      ).resolves.toMatchObject({
        minAmountEnabled: true,
        minAmount: toFiat(700),
      });
    });

    it('leaves the other limits alone', async () => {
      await expect(
        service.updateOwn(uuidOf(100), owner, {
          counterpartyOnly: true,
          maxCounterparties: 8,
          maxAmountEnabled: true,
          maxAmount: toFiat(100000),
        }),
      ).resolves.toMatchObject({
        maxAmountEnabled: true,
        maxAmount: toFiat(100000),
      });
    });
  });

  describe('findOwn', () => {
    it('finds the row when the owner asks', async () => {
      await expect(service.findOwn(uuidOf(100), owner)).resolves.toMatchObject({
        id: uuidOf(100),
      });
    });

    it('answers nothing when somebody else asks for the same id', async () => {
      await expect(service.findOwn(uuidOf(100), stranger)).resolves.toBeNull();
    });
  });

  describe('requisitesOfDeviceWithin', () => {
    it('reads the device’s requisites of its owner through the manager, deleted ones included', async () => {
      const find = jest.fn(async () => [{ id: uuidOf(100), bankId: 5 }]);
      const within = { getRepository: jest.fn(() => ({ find })) };

      await expect(
        service.requisitesOfDeviceWithin(within as never, 7, owner),
      ).resolves.toEqual([{ id: uuidOf(100), bankId: 5 }]);
      expect(within.getRepository).toHaveBeenCalledWith(BankDetails);
      expect(find).toHaveBeenCalledWith({
        select: { id: true, bankId: true },
        where: { deviceId: 7, userId: owner },
        order: { id: 'ASC' },
        withDeleted: true,
      });
    });
  });

  describe('list', () => {
    it('pages the query and loads the bank, the owner and who banned it', async () => {
      await service.list({
        page: 2,
        limit: 10,
        sortBy: BankDetailsSortField.MinAmount,
        sortOrder: SortOrder.Asc,
        userId: owner,
      });

      expect(bankDetails.findAndCount).toHaveBeenCalledWith({
        where: { userId: owner },
        order: { minAmount: 'ASC', id: 'ASC' },
        relations: {
          bank: { country: true, currency: true },
          mobileOperator: true,
          device: true,
          user: true,
          bannedBy: true,
        },
        skip: 10,
        take: 10,
      });
    });
  });

  describe('the payload a type carries', () => {
    const mobile = (overrides: Partial<BankDetails> = {}): BankDetails =>
      card({
        id: uuidOf(101),
        type: BankDetailsType.Mobile,
        bankId: null,
        bank: null,
        card: null,
        phone: '+79161234567',
        mobileOperatorId: 4,
        ...overrides,
      });

    it('creates a mobile requisite with a phone and an operator, and no bank', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        type: BankDetailsType.Mobile,
        phone: '+79161234567',
        mobileOperatorId: 4,
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BankDetailsType.Mobile,
          bankId: null,
          card: null,
          phone: '+79161234567',
          mobileOperatorId: 4,
        }),
      );
      expect(banks.findById).not.toHaveBeenCalled();
      expect(mobileOperators.findById).toHaveBeenCalledWith(4);
    });

    it.each([
      ['a bank', { bankId: 1 }],
      ['a card', { card: '4400430212345678' }],
      ['no phone', { phone: undefined }],
      ['no operator', { mobileOperatorId: undefined }],
    ])('refuses a mobile requisite with %s', async (_, overrides) => {
      await expect(
        service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          type: BankDetailsType.Mobile,
          phone: '+79161234567',
          mobileOperatorId: 4,
          ...overrides,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(bankDetails.save).not.toHaveBeenCalled();
    });

    it.each([
      ['no bank', { bankId: undefined }],
      ['neither a card nor a phone', { card: undefined }],
      ['a mobile operator', { mobileOperatorId: 4 }],
    ])('refuses a card-or-sbp requisite with %s', async (_, overrides) => {
      await expect(
        service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          bankId: 1,
          type: BankDetailsType.CardOrSbp,
          card: '4400430212345678',
          ...overrides,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(bankDetails.save).not.toHaveBeenCalled();
    });

    it('takes a card-or-sbp requisite carrying both a card and a phone', async () => {
      await service.create({
        userId: owner,
        deviceId: 7,
        dailyAmountLimit: toFiat(300000),
        bankId: 1,
        type: BankDetailsType.CardOrSbp,
        card: '4400430212345678',
        phone: '+79991234567',
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          card: '4400430212345678',
          phone: '+79991234567',
        }),
      );
    });

    it('answers 400 for a mobile operator that does not exist', async () => {
      mobileOperators.findById.mockResolvedValue(null);

      await expect(
        service.create({
          userId: owner,
          deviceId: 7,
          dailyAmountLimit: toFiat(300000),
          type: BankDetailsType.Mobile,
          phone: '+79161234567',
          mobileOperatorId: 9,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('drops the bank and the card when a patch turns a requisite mobile', async () => {
      stored = [card({ phone: '+79161234567' })];

      await service.updateOwn(uuidOf(100), owner, {
        type: BankDetailsType.Mobile,
        mobileOperatorId: 4,
      });

      expect(stored[0]).toMatchObject({
        type: BankDetailsType.Mobile,
        bankId: null,
        card: null,
        phone: '+79161234567',
        mobileOperatorId: 4,
      });
    });

    it('refuses to turn a requisite mobile without an operator', async () => {
      stored = [card({ phone: '+79161234567' })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { type: BankDetailsType.Mobile }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a card sent with the switch to mobile, rather than dropping it', async () => {
      stored = [card({ phone: '+79161234567' })];

      await expect(
        service.updateOwn(uuidOf(100), owner, {
          type: BankDetailsType.Mobile,
          mobileOperatorId: 4,
          card: '4400430212345678',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('drops the operator and asks for a bank when a mobile requisite turns card-or-sbp', async () => {
      stored = [mobile()];

      await expect(
        service.updateOwn(uuidOf(101), owner, {
          type: BankDetailsType.CardOrSbp,
        }),
      ).rejects.toThrow(BadRequestException);

      await service.updateOwn(uuidOf(101), owner, {
        type: BankDetailsType.CardOrSbp,
        bankId: 1,
      });

      expect(stored[0]).toMatchObject({
        type: BankDetailsType.CardOrSbp,
        bankId: 1,
        mobileOperatorId: null,
        phone: '+79161234567',
      });
    });

    it('refuses a bank patched onto a mobile requisite', async () => {
      stored = [mobile()];

      await expect(
        service.updateOwn(uuidOf(101), owner, { bankId: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lets a mobile requisite be switched off without restating its payload', async () => {
      stored = [mobile()];

      await expect(
        service.updateOwn(uuidOf(101), owner, { active: false }),
      ).resolves.toMatchObject({ active: false });
    });
  });

  describe('listIds', () => {
    it('asks for the ids alone, under the same filters, ordered by id', async () => {
      stored = [card({ id: uuidOf(1) }), card({ id: uuidOf(2) })];

      await expect(
        service.listIds({
          page: 3,
          limit: 5,
          sortBy: BankDetailsSortField.TurnoverTotal,
          sortOrder: SortOrder.Asc,
          userId: owner,
        }),
      ).resolves.toEqual([uuidOf(1), uuidOf(2)]);
      expect(bankDetails.find).toHaveBeenCalledWith({
        select: { id: true },
        where: { userId: owner },
        order: { id: 'ASC' },
      });
    });
  });

  describe('findByIdsInOrder', () => {
    it('returns the rows in the order of the ids it was given', async () => {
      stored = [
        card({ id: uuidOf(1) }),
        card({ id: uuidOf(2) }),
        card({ id: uuidOf(3) }),
      ];

      const found = await service.findByIdsInOrder([
        uuidOf(3),
        uuidOf(1),
        uuidOf(2),
      ]);

      expect(found.map((row) => row.id)).toEqual([
        uuidOf(3),
        uuidOf(1),
        uuidOf(2),
      ]);
    });

    it('does not query for no ids', async () => {
      await expect(service.findByIdsInOrder([])).resolves.toEqual([]);
      expect(bankDetails.find).not.toHaveBeenCalled();
    });
  });

  describe('updateOwn', () => {
    it('answers 404 when the row belongs to somebody else', async () => {
      await expect(
        service.updateOwn(uuidOf(100), stranger, { active: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets the owner switch their own details off', async () => {
      await expect(
        service.updateOwn(uuidOf(100), owner, { active: false }),
      ).resolves.toMatchObject({ active: false });
    });

    it('refuses to activate details an administrator banned', async () => {
      stored = [card({ bannedAt: new Date(), active: false })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { active: true }),
      ).rejects.toThrow(ConflictException);
    });

    it('still lets a banned row be edited otherwise, since a ban blocks its use anyway', async () => {
      stored = [card({ bannedAt: new Date() })];

      await expect(
        service.updateOwn(uuidOf(100), owner, {
          minAmountEnabled: true,
          minAmount: toFiat(500),
        }),
      ).resolves.toMatchObject({ minAmount: toFiat(500) });
    });

    it('drops the limit to null when its toggle is switched off', async () => {
      stored = [card({ minAmountEnabled: true, minAmount: toFiat(500) })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { minAmountEnabled: false }),
      ).resolves.toMatchObject({ minAmountEnabled: false, minAmount: null });
    });

    it('ignores a limit sent while its toggle stays off', async () => {
      await expect(
        service.updateOwn(uuidOf(100), owner, { dailyLimit: 40 }),
      ).resolves.toMatchObject({ dailyLimitEnabled: false, dailyLimit: null });
    });

    it('keeps a standing limit when an unrelated field is patched', async () => {
      stored = [card({ maxAmountEnabled: true, maxAmount: toFiat(100000) })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { card: '4400430212345679' }),
      ).resolves.toMatchObject({
        maxAmountEnabled: true,
        maxAmount: toFiat(100000),
      });
    });

    it('takes a limit on its own once the toggle is already on', async () => {
      stored = [card({ maxAmountEnabled: true, maxAmount: toFiat(100000) })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { maxAmount: toFiat(250000) }),
      ).resolves.toMatchObject({ maxAmount: toFiat(250000) });
    });

    it('checks a moved bank exists', async () => {
      banks.findById.mockResolvedValue(null);

      await expect(
        service.updateOwn(uuidOf(100), owner, { bankId: 9 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('supervise', () => {
    it('answers 404 for an id nobody holds', async () => {
      await expect(
        service.supervise(uuidOf(404), { active: false }, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('records who banned the details and when', async () => {
      const banned = await service.supervise(
        uuidOf(100),
        { banned: true },
        admin,
      );

      expect(banned.bannedByUserId).toBe(admin);
      expect(banned.bannedAt).toBeInstanceOf(Date);
    });

    it('clears both columns when the ban is lifted', async () => {
      stored = [card({ bannedAt: new Date(), bannedByUserId: admin })];

      const lifted = await service.supervise(
        uuidOf(100),
        { banned: false },
        admin,
      );

      expect(lifted.bannedAt).toBeNull();
      expect(lifted.bannedByUserId).toBeNull();
    });

    it('leaves the ban alone when only active was given', async () => {
      const bannedAt = new Date();
      stored = [card({ bannedAt, bannedByUserId: admin })];

      const supervised = await service.supervise(
        uuidOf(100),
        { active: false },
        admin,
      );

      expect(supervised.bannedAt).toBe(bannedAt);
      expect(supervised.active).toBe(false);
    });

    it('switches details on without touching who owns them', async () => {
      const supervised = await service.supervise(
        uuidOf(100),
        { active: false },
        admin,
      );

      expect(supervised.userId).toBe(owner);
    });
  });

  describe('the counterparty links', () => {
    const lockedFind = jest.fn();

    beforeEach(() => {
      lockedFind.mockReset();
      lockedFind.mockImplementation(
        async (_entity, options) =>
          stored.find((row) => row.id === options.where.id) ?? null,
      );
      Object.assign(manager, { findOne: lockedFind });
    });

    afterEach(() => {
      delete (manager as Record<string, unknown>).findOne;
    });

    describe('deleting', () => {
      it('unbinds the requisite from its counterparties when the owner deletes it', async () => {
        await service.deleteOwn(uuidOf(100), owner);

        expect(counterparties.unbindRequisiteWithin).toHaveBeenCalledWith(
          manager,
          uuidOf(100),
          RequisiteEventReason.RequisiteDeleted,
        );
      });

      it('unbinds the requisite from its counterparties when an administrator deletes it', async () => {
        await service.delete(uuidOf(100), admin);

        expect(counterparties.unbindRequisiteWithin).toHaveBeenCalledWith(
          manager,
          uuidOf(100),
          RequisiteEventReason.RequisiteDeleted,
        );
      });

      it('unbinds nothing when the delete is refused', async () => {
        await expect(service.deleteOwn(uuidOf(100), stranger)).rejects.toThrow(
          NotFoundException,
        );

        expect(counterparties.unbindRequisiteWithin).not.toHaveBeenCalled();
      });
    });

    describe('updateOwn and counterpartyOnly', () => {
      it('unbinds with the cleared reason when the flag goes from true to false', async () => {
        stored = [card({ counterpartyOnly: true })];

        await service.updateOwn(uuidOf(100), owner, {
          counterpartyOnly: false,
        });

        expect(counterparties.unbindRequisiteWithin).toHaveBeenCalledWith(
          manager,
          uuidOf(100),
          RequisiteEventReason.CounterpartyOnlyCleared,
        );
      });

      it('does not unbind when the flag stays true', async () => {
        stored = [card({ counterpartyOnly: true })];

        await service.updateOwn(uuidOf(100), owner, {
          counterpartyOnly: true,
          maxCounterparties: 8,
        });

        expect(counterparties.unbindRequisiteWithin).not.toHaveBeenCalled();
      });

      it('does not unbind when the flag goes from false to true', async () => {
        await service.updateOwn(uuidOf(100), owner, {
          counterpartyOnly: true,
          maxCounterparties: 8,
        });

        expect(counterparties.unbindRequisiteWithin).not.toHaveBeenCalled();
      });

      it('does not unbind when the flag is not part of the patch', async () => {
        stored = [card({ counterpartyOnly: true })];

        await service.updateOwn(uuidOf(100), owner, { active: false });

        expect(counterparties.unbindRequisiteWithin).not.toHaveBeenCalled();
      });
    });

    describe('bindToCounterparty', () => {
      it('locks the requisite with a pessimistic write on the transaction manager', async () => {
        await service.bindToCounterparty(
          uuidOf(100),
          5,
          CounterpartyBindingType.Cards,
          admin,
        );

        expect(lockedFind).toHaveBeenCalledWith(BankDetails, {
          where: { id: uuidOf(100) },
          lock: { mode: 'pessimistic_write' },
        });
      });

      it('answers 404 for a missing requisite and binds nothing', async () => {
        await expect(
          service.bindToCounterparty(
            uuidOf(404),
            5,
            CounterpartyBindingType.Cards,
            admin,
          ),
        ).rejects.toThrow(NotFoundException);
        expect(counterparties.bindWithin).not.toHaveBeenCalled();
      });

      it('hands the facts of the requisite to the counterparties service', async () => {
        stored = [card({ counterpartyOnly: true })];

        await service.bindToCounterparty(
          uuidOf(100),
          5,
          CounterpartyBindingType.Sbp,
          admin,
        );

        expect(counterparties.bindWithin).toHaveBeenCalledWith(
          manager,
          5,
          expect.objectContaining({
            id: uuidOf(100),
            type: BankDetailsType.CardOrSbp,
            counterpartyOnly: true,
            maxCounterparties: 8,
            userId: owner,
          }),
          CounterpartyBindingType.Sbp,
          admin,
        );
      });
    });

    describe('replaceCounterpartyRequisite', () => {
      it('locks the requisite with a pessimistic write on the transaction manager', async () => {
        await service.replaceCounterpartyRequisite(uuidOf(100), 5, admin);

        expect(lockedFind).toHaveBeenCalledWith(BankDetails, {
          where: { id: uuidOf(100) },
          lock: { mode: 'pessimistic_write' },
        });
      });

      it('answers 404 for a missing requisite and replaces nothing', async () => {
        await expect(
          service.replaceCounterpartyRequisite(uuidOf(404), 5, admin),
        ).rejects.toThrow(NotFoundException);
        expect(counterparties.replaceWithin).not.toHaveBeenCalled();
      });

      it('hands the facts of the requisite to the counterparties service', async () => {
        stored = [card({ counterpartyOnly: true })];

        await service.replaceCounterpartyRequisite(uuidOf(100), 5, admin);

        expect(counterparties.replaceWithin).toHaveBeenCalledWith(
          manager,
          5,
          expect.objectContaining({
            id: uuidOf(100),
            type: BankDetailsType.CardOrSbp,
            counterpartyOnly: true,
            maxCounterparties: 8,
            userId: owner,
          }),
          admin,
        );
      });
    });

    describe('moveOwnCounterparty (TC08)', () => {
      beforeEach(() => {
        Object.assign(manager, {
          find: jest.fn(async (_entity, options) =>
            stored
              .filter((row) => row.userId === options.where.userId)
              .map((row) => ({ id: row.id })),
          ),
        });
      });

      afterEach(() => {
        delete (manager as Record<string, unknown>).find;
      });

      it('locks the target, then replaces within the owner’s own requisites, naming the impersonator', async () => {
        stored = [
          card({ counterpartyOnly: true }),
          card({ id: uuidOf(101), counterpartyOnly: true }),
          card({ id: uuidOf(102), userId: stranger }),
        ];

        await service.moveOwnCounterparty(owner, 5, uuidOf(100), uuidOf(9));

        expect(lockedFind).toHaveBeenCalledWith(BankDetails, {
          where: { id: uuidOf(100) },
          lock: { mode: 'pessimistic_write' },
        });
        expect(counterparties.replaceWithin).toHaveBeenCalledWith(
          manager,
          5,
          expect.objectContaining({ id: uuidOf(100), userId: owner }),
          owner,
          {
            boundToAnyOf: [uuidOf(100), uuidOf(101)],
            impersonatorUserId: uuidOf(9),
          },
        );
      });

      it('answers 404 for another trader’s or a missing requisite and moves nothing', async () => {
        stored = [card({ userId: stranger, counterpartyOnly: true })];

        for (const target of [uuidOf(100), uuidOf(404)]) {
          await expect(
            service.moveOwnCounterparty(owner, 5, target, null),
          ).rejects.toThrow(NotFoundException);
        }
        expect(counterparties.replaceWithin).not.toHaveBeenCalled();
      });
    });

    describe('the owner’s counterparty-only requisites', () => {
      it('lists only the caller’s, optionally one of them', async () => {
        await service.listOwnCounterpartyOnly(owner, {
          page: 1,
          limit: 20,
          sortOrder: SortOrder.Desc,
          bankDetailsId: uuidOf(100),
        });

        expect(bankDetails.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              userId: owner,
              counterpartyOnly: true,
              id: uuidOf(100),
            },
          }),
        );
      });
    });

    describe('listCounterpartyOnly', () => {
      const query = { page: 2, limit: 10, sortOrder: SortOrder.Asc };

      it('restricts the list to counterparty-only requisites', async () => {
        await service.listCounterpartyOnly(query);

        expect(bankDetails.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { counterpartyOnly: true },
            skip: 10,
            take: 10,
            order: { createdAt: 'ASC', id: 'ASC' },
          }),
        );
      });

      it('adds the channel type when one is asked for', async () => {
        await service.listCounterpartyOnly({
          ...query,
          type: BankDetailsType.CardOrSbp,
        });

        expect(bankDetails.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { counterpartyOnly: true, type: BankDetailsType.CardOrSbp },
          }),
        );
      });

      it('searches the card, the phone and the cardholder name', async () => {
        await service.listCounterpartyOnly({ ...query, search: 'iv_n' });

        const [{ where }] = bankDetails.findAndCount.mock
          .calls[0] as unknown as [{ where: Record<string, unknown>[] }];
        expect(where).toHaveLength(3);
        expect(where.map((branch) => Object.keys(branch).sort())).toEqual(
          [
            ['card', 'counterpartyOnly'],
            ['counterpartyOnly', 'phone'],
            ['cardholderName', 'counterpartyOnly'],
          ].map((keys) => keys.sort()),
        );
        expect(where[0].card).toMatchObject({ value: '%iv\\_n%' });
      });
    });

    describe('findIdsMatching', () => {
      const rows = (count: number) =>
        Array.from({ length: count }, (_, index) => ({ id: uuidOf(index) }));

      it('returns the ids of the matching requisites', async () => {
        bankDetails.find.mockResolvedValueOnce(rows(2) as never);

        await expect(service.findIdsMatching('44')).resolves.toEqual([
          uuidOf(0),
          uuidOf(1),
        ]);
      });

      it('accepts exactly one thousand matches', async () => {
        bankDetails.find.mockResolvedValueOnce(rows(1000) as never);

        await expect(service.findIdsMatching('4')).resolves.toHaveLength(1000);
      });

      it('refuses with 400 when more than one thousand match', async () => {
        bankDetails.find.mockResolvedValueOnce(rows(1001) as never);

        await expect(service.findIdsMatching('4')).rejects.toThrow(
          BadRequestException,
        );
      });

      it('reads one row more than the cap to notice an overflow', async () => {
        bankDetails.find.mockResolvedValueOnce([] as never);

        await service.findIdsMatching('4');

        expect(bankDetails.find).toHaveBeenCalledWith(
          expect.objectContaining({ take: 1001 }),
        );
      });
    });

    describe('findIdsOfUsers', () => {
      it('does not query for no users', async () => {
        await expect(service.findIdsOfUsers([])).resolves.toEqual([]);
        expect(bankDetails.find).not.toHaveBeenCalled();
      });

      it('returns the ids of the requisites of the given users', async () => {
        bankDetails.find.mockResolvedValueOnce([{ id: uuidOf(100) }] as never);

        await expect(service.findIdsOfUsers([owner])).resolves.toEqual([
          uuidOf(100),
        ]);
      });
    });
  });
  describe('trader-cabinet rules (TC07)', () => {
    const input = (overrides: Record<string, unknown> = {}) => ({
      userId: owner,
      deviceId: 7,
      dailyAmountLimit: toFiat(300000),
      bankId: 1,
      type: BankDetailsType.CardOrSbp,
      card: '4400430212345678',
      ...overrides,
    });

    it('refuses a requisite without a daily turnover limit, writing nothing', async () => {
      await expect(
        service.create(input({ dailyAmountLimit: undefined })),
      ).rejects.toThrow(BadRequestException);
      expect(bankDetails.save).not.toHaveBeenCalled();
    });

    it('always asks whether the trader owns the device', async () => {
      await service.create(input());

      expect(devices.findOwn).toHaveBeenCalledWith(7, owner);
    });

    it('requires maxCounterparties on a counterparty-only requisite', async () => {
      await expect(
        service.create(input({ counterpartyOnly: true })),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses maxCounterparties on a requisite that is not counterparty-only', async () => {
      await expect(
        service.create(input({ maxCounterparties: 3 })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateOwn(uuidOf(100), owner, { maxCounterparties: 3 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores the slots beside the flag', async () => {
      await service.create(
        input({ counterpartyOnly: true, maxCounterparties: 3 }),
      );

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          counterpartyOnly: true,
          maxCounterparties: 3,
        }),
      );
    });

    it('drops the slots when the flag is cleared', async () => {
      stored = [card({ counterpartyOnly: true })];

      await service.updateOwn(uuidOf(100), owner, { counterpartyOnly: false });

      expect(stored[0].maxCounterparties).toBeNull();
    });

    it('keeps the stored slots while the flag stands and takes new ones', async () => {
      stored = [card({ counterpartyOnly: true })];

      await service.updateOwn(uuidOf(100), owner, { reserve: true });
      expect(stored[0].maxCounterparties).toBe(8);

      await service.updateOwn(uuidOf(100), owner, { maxCounterparties: 2 });
      expect(stored[0].maxCounterparties).toBe(2);
    });

    it('stores sameBankOnly', async () => {
      await service.create(input({ sameBankOnly: true }));

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ sameBankOnly: true }),
      );
    });

    describe('tags', () => {
      it('links the tags of the trader to a new requisite', async () => {
        const created = await service.create(input({ tagIds: [1, 2] }));

        expect(links).toEqual([
          { bankDetailsId: created.id, tagId: 1 },
          { bankDetailsId: created.id, tagId: 2 },
        ]);
      });

      it('answers 404 for a tag of another trader, writing nothing', async () => {
        await expect(
          service.create(input({ tagIds: [1, 500] })),
        ).rejects.toThrow(NotFoundException);
        expect(bankDetails.save).not.toHaveBeenCalled();
      });

      it('replaces the whole set on a patch, and [] clears it', async () => {
        links = [{ bankDetailsId: uuidOf(100), tagId: 1 }];

        await service.updateOwn(uuidOf(100), owner, { tagIds: [2, 3] });
        expect(links.map((link) => link.tagId)).toEqual([2, 3]);

        await service.updateOwn(uuidOf(100), owner, { tagIds: [] });
        expect(links).toEqual([]);
      });

      it('leaves the tags alone when a patch does not name them', async () => {
        links = [{ bankDetailsId: uuidOf(100), tagId: 1 }];

        await service.updateOwn(uuidOf(100), owner, { reserve: true });

        expect(links).toEqual([{ bankDetailsId: uuidOf(100), tagId: 1 }]);
      });

      it('refuses a name the trader already has, whatever its case', async () => {
        tags.findOne.mockResolvedValueOnce({ id: 1 });

        await expect(service.createTag(owner, 'СБЕР')).rejects.toThrow(
          ConflictException,
        );
        expect(tags.findOne).toHaveBeenCalledWith({
          where: { userId: owner, normalizedName: 'сбер' },
        });
      });

      it('creates a tag keeping the name as typed', async () => {
        tags.findOne.mockResolvedValueOnce(null);

        await expect(service.createTag(owner, 'Сбер')).resolves.toMatchObject({
          userId: owner,
          name: 'Сбер',
          normalizedName: 'сбер',
        });
      });

      it('answers 404 for deleting a tag of another trader', async () => {
        tags.findOne.mockResolvedValueOnce(null);

        await expect(service.deleteTag(stranger, 7)).rejects.toThrow(
          NotFoundException,
        );
        expect(tags.delete).not.toHaveBeenCalled();
      });
    });

    describe('the history rows', () => {
      it('writes bank_details.updated with the fields a patch sent', async () => {
        await service.updateOwn(
          uuidOf(100),
          owner,
          { reserve: true, cardholderName: 'IVAN' },
          uuidOf(5),
        );

        expect(activity()).toEqual([
          expect.objectContaining({
            actorUserId: owner,
            impersonatorUserId: uuidOf(5),
            targetUserId: owner,
            action: BankDetailsAction.Updated,
            metadata: expect.objectContaining({
              id: uuidOf(100),
              fields: ['reserve', 'cardholderName'],
            }),
          }),
        ]);
      });

      it('writes bank_details.disabled when the owner switches off, and nothing for a no-op', async () => {
        await service.updateOwn(uuidOf(100), owner, { active: false });
        await service.updateOwn(uuidOf(100), owner, { active: false });

        expect(activity().map((entry) => entry.action)).toEqual([
          BankDetailsAction.Disabled,
        ]);
      });

      it('writes the administrator’s ban and switch, with the owner as the target', async () => {
        await service.supervise(
          uuidOf(100),
          { active: false, banned: true },
          admin,
        );

        expect(activity()).toEqual([
          expect.objectContaining({
            actorUserId: admin,
            targetUserId: owner,
            action: BankDetailsAction.Disabled,
          }),
          expect.objectContaining({
            actorUserId: admin,
            targetUserId: owner,
            action: BankDetailsAction.Banned,
          }),
        ]);
      });
    });

    describe('the history', () => {
      const audited = {
        list: jest.fn(),
      };

      beforeEach(() => {
        Object.assign(audit, audited);
        audited.list.mockReset();
      });

      it('reads the requisite actions targeting the trader, marking rows newer than the last read', async () => {
        const lastReadAt = new Date('2026-11-04T10:00:00Z');
        reads.lastReadAt.mockResolvedValue(lastReadAt);
        audited.list.mockResolvedValue(
          toPage(
            [
              [
                { id: 2, createdAt: new Date('2026-11-04T11:00:00Z') },
                { id: 1, createdAt: new Date('2026-11-04T09:00:00Z') },
              ],
              2,
            ],
            { page: 1, limit: 20 },
          ),
        );

        const page = await service.history(owner, {
          page: 1,
          limit: 20,
          sortOrder: SortOrder.Desc,
        });

        expect(audited.list).toHaveBeenCalledWith(
          expect.objectContaining({
            targetUserId: owner,
            actions: expect.arrayContaining([
              ActivityAction.BankDetailsAdded,
              ActivityAction.BankDetailsDeleted,
              BankDetailsAction.Updated,
            ]),
          }),
        );
        expect(page.items.map((entry) => entry.unread)).toEqual([true, false]);
      });

      it('counts the rows after the last read', async () => {
        const lastReadAt = new Date('2026-11-04T10:00:00Z');
        reads.lastReadAt.mockResolvedValue(lastReadAt);
        audited.list.mockResolvedValue(toPage([[], 4], { page: 1, limit: 1 }));

        await expect(service.historyReadState(owner)).resolves.toEqual({
          lastReadAt,
          unreadCount: 4,
        });
        expect(audited.list).toHaveBeenCalledWith(
          expect.objectContaining({ createdAfter: lastReadAt }),
        );
      });

      it('marks everything read as of now', async () => {
        const state = await service.markHistoryRead(owner);

        expect(reads.markRead).toHaveBeenCalledWith(
          owner,
          'requisites',
          state.lastReadAt,
        );
        expect(state.unreadCount).toBe(0);
      });
    });
  });
});
