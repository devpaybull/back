import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { CountriesService } from '../../countries/countries.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import { BanksService } from '../banks.service';
import { Bank } from '../entities/bank.entity';
import { BankSortField } from '../types/bank-sort-field';
import { CreateBankInput } from '../types/create-bank-input';

describe('BanksService', () => {
  let stored: Bank[];
  let service: BanksService;

  const banks = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<Bank> }) =>
        stored.find((bank) =>
          Object.entries(where).every(
            ([field, value]) => bank[field] === value,
          ),
        ) ?? null,
    ),
    findAndCount: jest.fn(async () => [stored, stored.length]),
    find: jest.fn(async () => stored),
    create: jest.fn((data: Partial<Bank>) => ({ ...data }) as Bank),
    merge: jest.fn((target: Bank, patch: Partial<Bank>) =>
      Object.assign(target, patch),
    ),
    save: jest.fn(async (bank: Bank) => {
      if (stored.includes(bank)) return bank;

      const saved = { ...bank, id: bank.id ?? stored.length + 1 };
      stored.push(saved);

      return saved;
    }),
  };

  const countries = { findById: jest.fn(async () => ({ id: 1 })) };
  const currencies = { findById: jest.fn(async () => ({ id: 1 })) };

  const kaspi = (): Bank =>
    ({
      id: 1,
      bankId: 'kaspi',
      name: 'Kaspi Bank',
      code: 'KASPIKZKA',
      countryId: 1,
      transactionTypes: [TransactionType.Card],
      currencyId: 1,
      crossBorderCurrencyId: null,
      active: true,
      automatic: false,
      createdAt: new Date(),
    }) as Bank;

  const input = (
    overrides: Partial<CreateBankInput> = {},
  ): CreateBankInput => ({
    bankId: 'halyk',
    name: 'Halyk Bank',
    countryId: 1,
    transactionTypes: [TransactionType.Sbp],
    currencyId: 1,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    countries.findById.mockResolvedValue({ id: 1 });
    currencies.findById.mockResolvedValue({ id: 1 });
    stored = [kaspi()];

    const module = await Test.createTestingModule({
      providers: [
        BanksService,
        { provide: getRepositoryToken(Bank), useValue: banks },
        { provide: CountriesService, useValue: countries },
        { provide: CurrenciesService, useValue: currencies },
      ],
    }).compile();

    service = module.get(BanksService);
  });

  describe('create', () => {
    it('stores the bank and reads it back with its relations', async () => {
      const created = await service.create(input());

      expect(created).toMatchObject({ id: 2, bankId: 'halyk' });
      expect(banks.findOne).toHaveBeenLastCalledWith({
        where: { id: 2 },
        relations: {
          country: true,
          currency: { country: true },
          crossBorderCurrency: { country: true },
        },
      });
    });

    it('leaves an absent code and cross-border currency as null', async () => {
      await service.create(input());

      expect(banks.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: null, crossBorderCurrencyId: null }),
      );
    });

    it('lets the column defaults stand when active and automatic are absent', async () => {
      await service.create(input());

      const [data] = banks.create.mock.calls[0] as [Partial<Bank>];

      expect(data).not.toHaveProperty('active');
      expect(data).not.toHaveProperty('automatic');
    });

    it('refuses a bankId another bank holds', async () => {
      await expect(service.create(input({ bankId: 'kaspi' }))).rejects.toThrow(
        ConflictException,
      );
      expect(banks.save).not.toHaveBeenCalled();
    });

    it('refuses a code another bank holds', async () => {
      await expect(
        service.create(input({ code: 'KASPIKZKA' })),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a country that does not exist', async () => {
      countries.findById.mockResolvedValue(null);

      await expect(service.create(input())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a currency that does not exist', async () => {
      currencies.findById.mockResolvedValue(null);

      await expect(service.create(input())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('checks the cross-border currency exists as well', async () => {
      currencies.findById.mockResolvedValueOnce({ id: 1 });
      currencies.findById.mockResolvedValueOnce(null);

      await expect(
        service.create(input({ crossBorderCurrencyId: 9 })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('pages the query it was given and loads the relations', async () => {
      await service.list({
        page: 3,
        limit: 10,
        sortBy: BankSortField.Name,
        sortOrder: SortOrder.Asc,
        active: true,
      });

      expect(banks.findAndCount).toHaveBeenCalledWith({
        where: { active: true },
        order: { name: 'ASC', id: 'ASC' },
        relations: {
          country: true,
          currency: { country: true },
          crossBorderCurrency: { country: true },
        },
        skip: 20,
        take: 10,
      });
    });

    it('reports the total the database counted', async () => {
      const page = await service.list({
        page: 1,
        limit: 20,
        sortBy: BankSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
      });

      expect(page.meta).toEqual({ total: 1, page: 1, limit: 20, pages: 1 });
    });
  });

  describe('findByIds', () => {
    it('answers an empty id list without querying', async () => {
      await expect(service.findByIds([])).resolves.toEqual([]);
      expect(banks.find).not.toHaveBeenCalled();
    });

    it('asks for every id in one query', async () => {
      await service.findByIds([1, 2]);

      const [{ where }] = banks.find.mock.calls[0] as unknown as [
        { where: { id: { type: string; value: unknown } } },
      ];

      expect(banks.find).toHaveBeenCalledTimes(1);
      expect(where.id.type).toBe('in');
      expect(where.id.value).toEqual([1, 2]);
    });
  });

  describe('update', () => {
    it('answers 404 for an id nobody holds', async () => {
      await expect(service.update(404, { name: 'Nothing' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deactivates a bank, which is how one is retired', async () => {
      await expect(service.update(1, { active: false })).resolves.toMatchObject(
        { id: 1, active: false },
      );
    });

    it('lets a bank keep its own bankId and code', async () => {
      await expect(
        service.update(1, { bankId: 'kaspi', code: 'KASPIKZKA' }),
      ).resolves.toMatchObject({ id: 1 });
    });

    it('checks a moved country still exists', async () => {
      countries.findById.mockResolvedValue(null);

      await expect(service.update(1, { countryId: 9 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
