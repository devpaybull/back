import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { ActivityAction } from '../../audit/types/activity-action.enum';
import { BanksService } from '../../banks/banks.service';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { DevicesService } from '../../devices/devices.service';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { BankDetailsService } from '../bank-details.service';
import { BankDetails } from '../entities/bank-details.entity';
import { BankDetailsSortField } from '../types/bank-details-sort-field';

describe('BankDetailsService', () => {
  const owner = uuidOf(1);
  const stranger = uuidOf(2);
  const admin = uuidOf(3);

  let stored: BankDetails[];
  let service: BankDetailsService;

  const manager = {
    getRepository: jest.fn(() => bankDetails),
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
    find: jest.fn(async (options: { where: { id?: { value: string[] } } }) =>
      options.where.id
        ? stored.filter((row) => options.where.id.value.includes(row.id))
        : stored,
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

  const banks = { findById: jest.fn(async () => ({ id: 1 })) };

  const config = { get: jest.fn(() => 5000) };

  const devices = {
    findOwn: jest.fn(async () => ({ id: 7 })),
    delete: jest.fn(async () => undefined),
  };

  const activity = () =>
    audit.record.mock.calls.map(([entry]) => entry as Record<string, unknown>);

  const card = (overrides: Partial<BankDetails> = {}): BankDetails =>
    ({
      id: uuidOf(100),
      userId: owner,
      bankId: 1,
      type: TransactionType.Card,
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
      dailyAmountLimitEnabled: false,
      dailyAmountLimit: null,
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
      ...overrides,
    }) as BankDetails;

  beforeEach(async () => {
    jest.clearAllMocks();
    banks.findById.mockResolvedValue({ id: 1 });
    devices.findOwn.mockResolvedValue({ id: 7 });
    stored = [card()];
    audit.record.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        BankDetailsService,
        { provide: getRepositoryToken(BankDetails), useValue: bankDetails },
        { provide: BanksService, useValue: banks },
        { provide: DevicesService, useValue: devices },
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(BankDetailsService);
  });

  describe('create', () => {
    it('writes a bank_details_added row for the owner, in the creating transaction', async () => {
      const created = await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
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
            type: TransactionType.Card,
            card: '2204321033002239',
            phone: null,
            cardholderName: 'IVAN IVANOV',
            bankId: 1,
            bankName: null,
          },
        },
        manager,
      );
    });

    it('names the superadmin of a login-link session beside the trader', async () => {
      await service.create(
        { userId: owner, bankId: 1, type: TransactionType.Card },
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
        bankId: 1,
        type: TransactionType.Sbp,
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
          bankId: 1,
          type: TransactionType.Card,
        }),
      ).rejects.toThrow('audit down');
      expect(stored).toHaveLength(1);
    });

    it('writes no activity row when the bank does not exist', async () => {
      banks.findById.mockResolvedValue(null);

      await expect(
        service.create({
          userId: owner,
          bankId: 9,
          type: TransactionType.Card,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('stores the details against the owner it was told', async () => {
      await service.create({
        userId: stranger,
        bankId: 1,
        type: TransactionType.Sbp,
        phone: '+79991234567',
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: stranger, phone: '+79991234567' }),
      );
    });

    it('keeps the card whole, digits and all', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
        card: '0000430212345678',
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ card: '0000430212345678' }),
      );
    });

    it('writes the absent optional fields as null', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cardholderName: null,
          card: null,
          phone: null,
          minAmount: null,
          maxAmount: null,
          dailyLimit: null,
          monthlyLimit: null,
          dailyAmountLimit: null,
          monthlyAmountLimit: null,
          maxActiveTransactions: null,
          delayBetweenRequests: null,
        }),
      );
    });

    it('starts every toggle off, and the two standing flags with it', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountEnabled: false,
          maxAmountEnabled: false,
          dailyLimitEnabled: false,
          monthlyLimitEnabled: false,
          dailyAmountLimitEnabled: false,
          monthlyAmountLimitEnabled: false,
          maxActiveTransactionsEnabled: false,
          delayBetweenRequestsEnabled: false,
          counterpartyOnly: false,
          reserve: false,
        }),
      );
    });

    it('drops a limit whose toggle was not switched on', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
        minAmount: 500,
        dailyLimit: 40,
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ minAmount: null, dailyLimit: null }),
      );
    });

    it('keeps a limit whose toggle came with it', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
        minAmountEnabled: true,
        minAmount: 500,
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ minAmountEnabled: true, minAmount: 500 }),
      );
    });

    it('lets the column default stand when active is absent', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
      });

      const [data] = bankDetails.create.mock.calls[0] as [Partial<BankDetails>];

      expect(data).not.toHaveProperty('active');
    });

    it('refuses a bank that does not exist', async () => {
      banks.findById.mockResolvedValue(null);

      await expect(
        service.create({
          userId: owner,
          bankId: 9,
          type: TransactionType.Card,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(bankDetails.save).not.toHaveBeenCalled();
    });

    it('puts no ceiling on how many one account may hold', async () => {
      for (let n = 0; n < 5; n += 1) {
        await service.create({
          userId: owner,
          bankId: 1,
          type: TransactionType.Card,
        });
      }

      expect(stored).toHaveLength(6);
    });
  });

  describe('binding a device', () => {
    it('binds a device the trader owns', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
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
          bankId: 1,
          type: TransactionType.Card,
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

    it('asks nothing when no device was named', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
      });

      expect(devices.findOwn).not.toHaveBeenCalled();
      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: null }),
      );
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
            type: TransactionType.Card,
            card: '4400430212345678',
            phone: null,
            cardholderName: null,
            bankId: 1,
            bankName: 'Sber',
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
    it('unbinds every requisite first, then deletes the device', async () => {
      stored = [card({ deviceId: 7 })];

      await service.deleteDevice(7, admin);

      expect(bankDetails.update).toHaveBeenCalledWith(
        { deviceId: 7 },
        { deviceId: null },
      );
      expect(devices.delete).toHaveBeenCalledWith(7, admin, manager, null);
      expect(stored[0].deviceId).toBeNull();
      expect(stored[0].deletedAt).toBeUndefined();
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

    it('unbinds inside the same transaction as the device delete, so a failure restores the binding', async () => {
      stored = [card({ deviceId: 7 })];
      devices.delete.mockRejectedValueOnce(new Error('device down'));

      await expect(service.deleteDevice(7, admin)).rejects.toThrow(
        'device down',
      );
      expect(stored[0].deviceId).toBe(7);
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
      expect(service.counterpartyMinAmount).toBe(5000);
      expect(config.get).toHaveBeenCalledWith('COUNTERPARTY_MIN_AMOUNT');
    });

    it('turns the minimum on and leaves the column empty, since the floor lives in config', async () => {
      await service.create({
        userId: owner,
        bankId: 1,
        type: TransactionType.Card,
        counterpartyOnly: true,
      });

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({
          counterpartyOnly: true,
          minAmountEnabled: true,
          minAmount: null,
        }),
      );
    });

    it('answers 409 when a creation tries to set the minimum itself', async () => {
      await expect(
        service.create({
          userId: owner,
          bankId: 1,
          type: TransactionType.Card,
          counterpartyOnly: true,
          minAmount: 100,
        }),
      ).rejects.toThrow(ConflictException);
      expect(bankDetails.save).not.toHaveBeenCalled();
    });

    it('answers 409 when a creation tries to switch the minimum off', async () => {
      await expect(
        service.create({
          userId: owner,
          bankId: 1,
          type: TransactionType.Card,
          counterpartyOnly: true,
          minAmountEnabled: false,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('answers 409 when a patch sets the minimum on a row already counterparty-only', async () => {
      stored = [card({ counterpartyOnly: true, minAmountEnabled: true })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { minAmount: 100 }),
      ).rejects.toThrow(ConflictException);
    });

    it('answers 409 when one patch turns the flag on and sets the minimum together', async () => {
      await expect(
        service.updateOwn(uuidOf(100), owner, {
          counterpartyOnly: true,
          minAmount: 100,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('clears the trader’s own minimum when the flag goes on', async () => {
      stored = [card({ minAmountEnabled: true, minAmount: 700 })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { counterpartyOnly: true }),
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
          minAmount: 700,
        }),
      ).resolves.toMatchObject({ minAmountEnabled: true, minAmount: 700 });
    });

    it('leaves the other limits alone', async () => {
      await expect(
        service.updateOwn(uuidOf(100), owner, {
          counterpartyOnly: true,
          maxAmountEnabled: true,
          maxAmount: 100000,
        }),
      ).resolves.toMatchObject({ maxAmountEnabled: true, maxAmount: 100000 });
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
          device: true,
          user: true,
          bannedBy: true,
        },
        skip: 10,
        take: 10,
      });
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
          minAmount: 500,
        }),
      ).resolves.toMatchObject({ minAmount: 500 });
    });

    it('drops the limit to null when its toggle is switched off', async () => {
      stored = [card({ minAmountEnabled: true, minAmount: 500 })];

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
      stored = [card({ maxAmountEnabled: true, maxAmount: 100000 })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { card: '4400430212345679' }),
      ).resolves.toMatchObject({ maxAmountEnabled: true, maxAmount: 100000 });
    });

    it('takes a limit on its own once the toggle is already on', async () => {
      stored = [card({ maxAmountEnabled: true, maxAmount: 100000 })];

      await expect(
        service.updateOwn(uuidOf(100), owner, { maxAmount: 250000 }),
      ).resolves.toMatchObject({ maxAmount: 250000 });
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
});
