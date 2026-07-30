import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { SortOrder } from '../enums/sort-order.enum';

const parse = (query: Record<string, unknown> = {}): PaginationQueryDto =>
  plainToInstance(PaginationQueryDto, query);

const failedProperties = (query: Record<string, unknown>): string[] =>
  validateSync(parse(query)).map((error) => error.property);

describe('PaginationQueryDto', () => {
  describe('defaults', () => {
    it('pages from the first page, twenty rows at a time, newest first', () => {
      expect(parse()).toEqual({
        page: 1,
        limit: 20,
        sortOrder: SortOrder.Desc,
      });
    });

    it('validates with nothing given at all', () => {
      expect(failedProperties({})).toEqual([]);
    });
  });

  describe('page', () => {
    it('arrives as a number, not the string the query string carries', () => {
      expect(parse({ page: '3' }).page).toBe(3);
    });

    it.each([['0'], ['-1']])('refuses page %s', (page) => {
      expect(failedProperties({ page })).toEqual(['page']);
    });

    it('refuses a fractional page', () => {
      expect(failedProperties({ page: '1.5' })).toEqual(['page']);
    });

    it('refuses a page that is not a number at all', () => {
      expect(failedProperties({ page: 'second' })).toEqual(['page']);
    });
  });

  describe('limit', () => {
    it('arrives as a number, not the string the query string carries', () => {
      expect(parse({ limit: '50' }).limit).toBe(50);
    });

    it('accepts the largest page the API serves', () => {
      expect(failedProperties({ limit: '100' })).toEqual([]);
    });

    it('refuses more than a hundred rows', () => {
      expect(failedProperties({ limit: '101' })).toEqual(['limit']);
    });

    it('refuses a wildly oversized page instead of quietly clamping it', () => {
      expect(failedProperties({ limit: '5000' })).toEqual(['limit']);
      expect(parse({ limit: '5000' }).limit).toBe(5000);
    });

    it('refuses an empty page', () => {
      expect(failedProperties({ limit: '0' })).toEqual(['limit']);
    });
  });

  describe('search', () => {
    it('is optional', () => {
      expect(parse().search).toBeUndefined();
    });

    it('is trimmed', () => {
      expect(parse({ search: '  durov  ' }).search).toBe('durov');
    });

    it('accepts a hundred characters', () => {
      expect(failedProperties({ search: 'a'.repeat(100) })).toEqual([]);
    });

    it('refuses more than a hundred characters', () => {
      expect(failedProperties({ search: 'a'.repeat(101) })).toEqual(['search']);
    });

    it('measures the length after trimming', () => {
      expect(failedProperties({ search: ` ${'a'.repeat(100)} ` })).toEqual([]);
    });
  });

  describe('sortOrder', () => {
    it.each([SortOrder.Asc, SortOrder.Desc])('accepts %s', (sortOrder) => {
      expect(failedProperties({ sortOrder })).toEqual([]);
    });

    it('refuses an order outside the two it knows', () => {
      expect(failedProperties({ sortOrder: 'sideways' })).toEqual([
        'sortOrder',
      ]);
    });
  });

  describe('through the pipe main.ts installs', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    const metadata = {
      type: 'query' as const,
      metatype: PaginationQueryDto,
    };

    it('fills in the defaults a query string leaves out', async () => {
      await expect(pipe.transform({}, metadata)).resolves.toEqual({
        page: 1,
        limit: 20,
        sortOrder: SortOrder.Desc,
      });
    });

    it('hands the handler numbers, not the strings it received', async () => {
      const query = await pipe.transform({ page: '2', limit: '5' }, metadata);

      expect(query.page).toBe(2);
      expect(query.limit).toBe(5);
    });

    it('trims the search term', async () => {
      const query = await pipe.transform({ search: '  durov ' }, metadata);

      expect(query.search).toBe('durov');
    });

    const refusalFor = async (
      query: Record<string, unknown>,
    ): Promise<string> => {
      try {
        await pipe.transform(query, metadata);
      } catch (error) {
        if (error instanceof BadRequestException) {
          return JSON.stringify(error.getResponse());
        }

        throw error;
      }

      throw new Error(`${JSON.stringify(query)} was accepted`);
    };

    it('answers a five-thousand-row request with a refusal, never a clamp', async () => {
      await expect(refusalFor({ limit: '5000' })).resolves.toContain('limit');
    });

    it('answers an unknown query parameter with a refusal', async () => {
      await expect(refusalFor({ orderBy: 'email' })).resolves.toContain(
        'orderBy',
      );
    });
  });
});
