import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CountriesService } from '../countries.service';
import { Country } from '../entities/country.entity';

describe('CountriesService', () => {
  let stored: Country[];
  let service: CountriesService;

  const countries = {
    find: jest.fn(async () => stored),
    findOne: jest.fn(
      async ({ where }: { where: Partial<Country> }) =>
        stored.find((country) =>
          Object.entries(where).every(
            ([field, value]) => country[field] === value,
          ),
        ) ?? null,
    ),
    create: jest.fn((data: Partial<Country>) => ({ ...data }) as Country),
    merge: jest.fn((target: Country, patch: Partial<Country>) =>
      Object.assign(target, patch),
    ),
    save: jest.fn(async (country: Country) => {
      if (stored.includes(country)) return country;

      const saved = { ...country, id: country.id ?? stored.length + 1 };
      stored.push(saved);

      return saved;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    stored = [
      { id: 1, name: 'Kazakhstan' },
      { id: 2, name: 'Georgia' },
    ] as Country[];

    const module = await Test.createTestingModule({
      providers: [
        CountriesService,
        { provide: getRepositoryToken(Country), useValue: countries },
      ],
    }).compile();

    service = module.get(CountriesService);
  });

  describe('create', () => {
    it('stores a country and hands back the saved row', async () => {
      await expect(service.create({ name: 'Armenia' })).resolves.toEqual({
        id: 3,
        name: 'Armenia',
      });
      expect(stored).toHaveLength(3);
    });

    it('refuses a name that already exists', async () => {
      await expect(service.create({ name: 'Georgia' })).rejects.toThrow(
        ConflictException,
      );
      expect(countries.save).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('orders by name so a select reads alphabetically', async () => {
      await service.list();

      expect(countries.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
    });
  });

  describe('update', () => {
    it('renames a country', async () => {
      await expect(service.update(2, { name: 'Sakartvelo' })).resolves.toEqual({
        id: 2,
        name: 'Sakartvelo',
      });
    });

    it('answers 404 for an id nobody holds', async () => {
      await expect(service.update(404, { name: 'Nowhere' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a rename onto another country', async () => {
      await expect(service.update(2, { name: 'Kazakhstan' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('lets a country keep its own name', async () => {
      await expect(service.update(2, { name: 'Georgia' })).resolves.toEqual({
        id: 2,
        name: 'Georgia',
      });
    });
  });
});
