import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { CountriesService } from '../../countries/countries.service';
import { MobileOperator } from '../entities/mobile-operator.entity';
import { MobileOperatorsService } from '../mobile-operators.service';
import { MobileOperatorSortField } from '../types/mobile-operator-sort-field';

describe('MobileOperatorsService', () => {
  let stored: MobileOperator[];
  let service: MobileOperatorsService;

  const operators = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<MobileOperator> }) =>
        stored.find((operator) =>
          Object.entries(where).every(
            ([field, value]) => operator[field] === value,
          ),
        ) ?? null,
    ),
    findAndCount: jest.fn(async () => [stored, stored.length]),
    create: jest.fn(
      (data: Partial<MobileOperator>) => ({ ...data }) as MobileOperator,
    ),
    merge: jest.fn((target: MobileOperator, patch: Partial<MobileOperator>) =>
      Object.assign(target, patch),
    ),
    save: jest.fn(async (operator: MobileOperator) => {
      if (stored.includes(operator)) return operator;

      const saved = { ...operator, id: operator.id ?? stored.length + 1 };
      stored.push(saved);

      return saved;
    }),
  };

  const countries = { findById: jest.fn() };

  const mts = (): MobileOperator =>
    ({
      id: 1,
      code: 'mts',
      name: 'MTS',
      countryId: 1,
      active: true,
      createdAt: new Date(),
    }) as MobileOperator;

  beforeEach(async () => {
    jest.clearAllMocks();
    countries.findById.mockResolvedValue({ id: 1 });
    stored = [mts()];

    const module = await Test.createTestingModule({
      providers: [
        MobileOperatorsService,
        { provide: getRepositoryToken(MobileOperator), useValue: operators },
        { provide: CountriesService, useValue: countries },
      ],
    }).compile();

    service = module.get(MobileOperatorsService);
  });

  describe('create', () => {
    it('stores the operator and reads it back with its country', async () => {
      const created = await service.create({
        code: 'beeline',
        name: 'Beeline',
        countryId: 1,
      });

      expect(created).toMatchObject({ id: 2, code: 'beeline' });
      expect(operators.findOne).toHaveBeenLastCalledWith({
        where: { id: 2 },
        relations: { country: true },
      });
    });

    it('lets the column default stand when active is absent', async () => {
      await service.create({ code: 'beeline', name: 'Beeline', countryId: 1 });

      const [data] = operators.create.mock.calls[0] as [
        Partial<MobileOperator>,
      ];

      expect(data).not.toHaveProperty('active');
    });

    it('answers 409 for a code another operator holds', async () => {
      await expect(
        service.create({ code: 'mts', name: 'Other', countryId: 1 }),
      ).rejects.toThrow(ConflictException);
      expect(operators.save).not.toHaveBeenCalled();
    });

    it('answers 400 for a country that does not exist', async () => {
      countries.findById.mockResolvedValue(null);

      await expect(
        service.create({ code: 'beeline', name: 'Beeline', countryId: 9 }),
      ).rejects.toThrow(BadRequestException);
      expect(operators.save).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('pages through the filtered, ordered rows', async () => {
      const page = await service.list({
        page: 2,
        limit: 10,
        sortBy: MobileOperatorSortField.Name,
        sortOrder: SortOrder.Asc,
        active: true,
      });

      expect(operators.findAndCount).toHaveBeenCalledWith({
        where: { active: true },
        order: { name: 'ASC', id: 'ASC' },
        relations: { country: true },
        skip: 10,
        take: 10,
      });
      expect(page.meta.total).toBe(1);
    });
  });

  describe('update', () => {
    it('answers 404 for an operator nobody holds', async () => {
      await expect(service.update(404, { active: false })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets a patch resend the code the row already holds', async () => {
      await expect(
        service.update(1, { code: 'mts', active: false }),
      ).resolves.toMatchObject({ code: 'mts', active: false });
    });

    it('answers 409 for a code another operator holds', async () => {
      stored.push({ ...mts(), id: 2, code: 'beeline' } as MobileOperator);

      await expect(service.update(2, { code: 'mts' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('answers 400 for a country that does not exist', async () => {
      countries.findById.mockResolvedValue(null);

      await expect(service.update(1, { countryId: 9 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

describe('MobileOperatorsService.findActiveByCode', () => {
  it('looks up an active operator by its code', async () => {
    const operators = { findOne: jest.fn(async () => null) };
    const service = new MobileOperatorsService(operators as never, {} as never);

    await expect(service.findActiveByCode('mts')).resolves.toBeNull();
    expect(operators.findOne).toHaveBeenCalledWith({
      where: { code: 'mts', active: true },
    });
  });
});
