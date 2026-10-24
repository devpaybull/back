import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CountriesService } from '../../countries/countries.service';
import { Country } from '../../countries/entities/country.entity';
import { CurrenciesService } from '../currencies.service';
import { Currency } from '../entities/currency.entity';

describe('CurrenciesService', () => {
  const kazakhstan = { id: 1, name: 'Kazakhstan' } as Country;

  let stored: Currency[];
  let service: CurrenciesService;

  const currencies = {
    find: jest.fn(async () => stored),
    findOne: jest.fn(
      async ({ where }: { where: Partial<Currency> }) =>
        stored.find((currency) =>
          Object.entries(where).every(
            ([field, value]) => currency[field] === value,
          ),
        ) ?? null,
    ),
    create: jest.fn((data: Partial<Currency>) => ({ ...data }) as Currency),
    merge: jest.fn((target: Currency, patch: Partial<Currency>) =>
      Object.assign(target, patch),
    ),
    save: jest.fn(async (currency: Currency) => {
      if (stored.includes(currency)) return currency;

      const saved = { ...currency, id: currency.id ?? stored.length + 1 };
      stored.push(saved);

      return saved;
    }),
  };

  const countries = { findById: jest.fn(async () => kazakhstan) };

  const tenge = (): Currency =>
    ({
      id: 1,
      name: 'Kazakhstani tenge',
      isocode: 'KZT',
      countryId: 1,
      country: kazakhstan,
    }) as Currency;

  beforeEach(async () => {
    jest.clearAllMocks();
    countries.findById.mockResolvedValue(kazakhstan);
    stored = [tenge()];

    const module = await Test.createTestingModule({
      providers: [
        CurrenciesService,
        { provide: getRepositoryToken(Currency), useValue: currencies },
        { provide: CountriesService, useValue: countries },
      ],
    }).compile();

    service = module.get(CurrenciesService);
  });

  describe('create', () => {
    it('stores a currency and reads it back with its country', async () => {
      const created = await service.create({
        name: 'Georgian lari',
        isocode: 'GEL',
        countryId: 1,
      });

      expect(created).toMatchObject({ id: 2, isocode: 'GEL', countryId: 1 });
      expect(currencies.findOne).toHaveBeenLastCalledWith({
        where: { id: 2 },
        relations: { country: true },
      });
    });

    it('refuses an isocode another currency holds', async () => {
      await expect(
        service.create({ name: 'Tenge', isocode: 'KZT', countryId: 1 }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a country that does not exist', async () => {
      countries.findById.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Georgian lari', isocode: 'GEL', countryId: 9 }),
      ).rejects.toThrow(BadRequestException);
      expect(currencies.save).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('loads the country and orders by isocode', async () => {
      await service.list();

      expect(currencies.find).toHaveBeenCalledWith({
        relations: { country: true },
        order: { isocode: 'ASC' },
      });
    });
  });

  describe('update', () => {
    it('answers 404 for an id nobody holds', async () => {
      await expect(service.update(404, { name: 'Nothing' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets a currency keep its own isocode', async () => {
      await expect(
        service.update(1, { isocode: 'KZT', name: 'Tenge' }),
      ).resolves.toMatchObject({ id: 1, name: 'Tenge' });
    });

    it('checks a moved country exists', async () => {
      countries.findById.mockResolvedValue(null);

      await expect(service.update(1, { countryId: 9 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
