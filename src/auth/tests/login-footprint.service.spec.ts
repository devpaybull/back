import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Brackets } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { LoginFootprint } from '../entities/login-footprint.entity';
import { GeoIpService } from '../services/geo-ip.service';
import { LoginFootprintService } from '../services/login-footprint.service';

type Row = Pick<
  LoginFootprint,
  | 'id'
  | 'userId'
  | 'ip'
  | 'country'
  | 'fingerprint'
  | 'userAgent'
  | 'firstSeenAt'
  | 'lastSeenAt'
>;

const createFakeFootprints = () => {
  const rows: Row[] = [];
  let nextId = 1;
  const queryBuilderCalls = jest.fn();

  const upsert = jest.fn(
    async (
      values: Pick<
        Row,
        'userId' | 'ip' | 'country' | 'fingerprint' | 'userAgent' | 'lastSeenAt'
      >,
      conflictPaths: string[],
    ) => {
      const existing = rows.find((row) =>
        conflictPaths.every(
          (path) =>
            row[path as keyof Row] === values[path as keyof typeof values],
        ),
      );

      if (existing) {
        existing.country = values.country;
        existing.lastSeenAt = values.lastSeenAt;
        return;
      }

      rows.push({
        id: nextId++,
        ...values,
        firstSeenAt: values.lastSeenAt,
      });
    },
  );

  const findAndCount = jest.fn(
    async (options: {
      where: { userId: string };
      order: { lastSeenAt: 'ASC' | 'DESC'; id: 'ASC' | 'DESC' };
      skip: number;
      take: number;
    }) => {
      const sign = options.order.lastSeenAt === 'ASC' ? 1 : -1;
      const own = rows
        .filter((row) => row.userId === options.where.userId)
        .sort(
          (a, b) =>
            sign * (a.lastSeenAt.getTime() - b.lastSeenAt.getTime()) ||
            sign * (a.id - b.id),
        );

      return [
        own.slice(options.skip, options.skip + options.take),
        own.length,
      ] as [Row[], number];
    },
  );

  const createQueryBuilder = jest.fn(() => {
    queryBuilderCalls();
    const wanted: { ip: string; fingerprint: string; userAgent: string }[] = [];
    const builder = {
      select: () => builder,
      addSelect: () => builder,
      groupBy: () => builder,
      addGroupBy: () => builder,
      where: (brackets: Brackets) => {
        const parameters: Record<string, string>[] = [];
        (
          brackets as unknown as {
            whereFactory: (qb: unknown) => void;
          }
        ).whereFactory({
          orWhere: (_sql: string, params: Record<string, string>) => {
            parameters.push(params);
          },
        });
        parameters.forEach((params, index) =>
          wanted.push({
            ip: params[`ip${index}`],
            fingerprint: params[`fingerprint${index}`],
            userAgent: params[`userAgent${index}`],
          }),
        );
        return builder;
      },
      getRawMany: async () =>
        wanted.map((combination) => ({
          ...combination,
          accounts: String(
            new Set(
              rows
                .filter(
                  (row) =>
                    row.ip === combination.ip &&
                    row.fingerprint === combination.fingerprint &&
                    row.userAgent === combination.userAgent,
                )
                .map((row) => row.userId),
            ).size,
          ),
        })),
    };

    return builder;
  });

  return { rows, upsert, findAndCount, createQueryBuilder, queryBuilderCalls };
};

describe('LoginFootprintService', () => {
  const geoIp = { countryOf: jest.fn() };
  let fake: ReturnType<typeof createFakeFootprints>;
  let service: LoginFootprintService;

  const context = {
    ip: '203.0.113.7',
    userAgent: 'agent/1.0',
    fingerprint: 'fp-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    geoIp.countryOf.mockReturnValue('DE');
    fake = createFakeFootprints();

    const module = await Test.createTestingModule({
      providers: [
        LoginFootprintService,
        { provide: getRepositoryToken(LoginFootprint), useValue: fake },
        { provide: GeoIpService, useValue: geoIp },
      ],
    }).compile();

    service = module.get(LoginFootprintService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('record', () => {
    it('inserts a row for a new combination, with the country', async () => {
      await service.record(uuidOf(1), context);

      expect(fake.rows).toEqual([
        expect.objectContaining({
          userId: uuidOf(1),
          ip: '203.0.113.7',
          country: 'DE',
          fingerprint: 'fp-1',
          userAgent: 'agent/1.0',
          firstSeenAt: new Date('2026-01-01T00:00:00Z'),
          lastSeenAt: new Date('2026-01-01T00:00:00Z'),
        }),
      ]);
      expect(geoIp.countryOf).toHaveBeenCalledWith('203.0.113.7');
    });

    it('conflicts on the whole combination of account, ip, fingerprint and agent', async () => {
      await service.record(uuidOf(1), context);

      expect(fake.upsert).toHaveBeenCalledWith(expect.any(Object), [
        'userId',
        'ip',
        'fingerprint',
        'userAgent',
      ]);
    });

    it('moves lastSeenAt of a repeated combination and keeps firstSeenAt', async () => {
      await service.record(uuidOf(1), context);
      jest.setSystemTime(new Date('2026-01-02T00:00:00Z'));
      await service.record(uuidOf(1), context);

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0].firstSeenAt).toEqual(
        new Date('2026-01-01T00:00:00Z'),
      );
      expect(fake.rows[0].lastSeenAt).toEqual(new Date('2026-01-02T00:00:00Z'));
    });

    it('adds a row when only the ip, the fingerprint or the agent differs', async () => {
      await service.record(uuidOf(1), context);
      await service.record(uuidOf(1), { ...context, ip: '203.0.113.8' });
      await service.record(uuidOf(1), { ...context, fingerprint: 'fp-2' });
      await service.record(uuidOf(1), { ...context, userAgent: 'agent/2.0' });

      expect(fake.rows).toHaveLength(4);
    });

    it('keeps a row per account for the same combination', async () => {
      await service.record(uuidOf(1), context);
      await service.record(uuidOf(2), context);

      expect(fake.rows.map((row) => row.userId)).toEqual([
        uuidOf(1),
        uuidOf(2),
      ]);
    });

    it('stores an empty string, not NULL, for a missing fingerprint and agent', async () => {
      await service.record(uuidOf(1), {
        ip: '203.0.113.7',
        userAgent: null,
        fingerprint: null,
      });
      await service.record(uuidOf(1), {
        ip: '203.0.113.7',
        userAgent: null,
        fingerprint: null,
      });

      expect(fake.rows).toEqual([
        expect.objectContaining({ fingerprint: '', userAgent: '' }),
      ]);
    });

    it('stores the unmapped form of an IPv4-mapped address', async () => {
      await service.record(uuidOf(1), { ...context, ip: '::ffff:203.0.113.7' });

      expect(fake.rows[0].ip).toBe('203.0.113.7');
    });

    it('stores a null country when the lookup finds none', async () => {
      geoIp.countryOf.mockReturnValue(null);

      await service.record(uuidOf(1), context);

      expect(fake.rows[0].country).toBeNull();
    });

    it('cuts a long agent and fingerprint to what the columns hold', async () => {
      await service.record(uuidOf(1), {
        ...context,
        fingerprint: 'f'.repeat(500),
        userAgent: 'u'.repeat(2000),
      });

      expect(fake.rows[0].fingerprint).toHaveLength(128);
      expect(fake.rows[0].userAgent).toHaveLength(512);
    });

    it('writes nothing when the request carried no address', async () => {
      await service.record(uuidOf(1), { ...context, ip: null });

      expect(fake.upsert).not.toHaveBeenCalled();
    });

    it('never throws when the write fails', async () => {
      fake.upsert.mockRejectedValue(new Error('connection lost'));

      await expect(service.record(uuidOf(1), context)).resolves.toBeUndefined();
    });

    it('never throws when the country lookup fails', async () => {
      geoIp.countryOf.mockImplementation(() => {
        throw new Error('reader broke');
      });

      await expect(service.record(uuidOf(1), context)).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    const query = { page: 1, limit: 20, sortOrder: SortOrder.Desc };

    it('returns an empty page without asking for counts', async () => {
      const page = await service.list(uuidOf(1), query);

      expect(page.items).toEqual([]);
      expect(page.meta).toEqual({ total: 0, page: 1, limit: 20, pages: 0 });
      expect(fake.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('lists only the account own rows, newest first, with empty strings as null', async () => {
      await service.record(uuidOf(1), { ...context, fingerprint: null });
      jest.setSystemTime(new Date('2026-01-02T00:00:00Z'));
      await service.record(uuidOf(1), { ...context, ip: '203.0.113.9' });
      await service.record(uuidOf(2), context);

      const page = await service.list(uuidOf(1), query);

      expect(page.items.map((item) => item.ip)).toEqual([
        '203.0.113.9',
        '203.0.113.7',
      ]);
      expect(page.items[1]).toMatchObject({
        fingerprint: null,
        userAgent: 'agent/1.0',
        country: 'DE',
      });
      expect(page.meta.total).toBe(2);
    });

    it('honours ascending order and paging', async () => {
      await service.record(uuidOf(1), context);
      jest.setSystemTime(new Date('2026-01-02T00:00:00Z'));
      await service.record(uuidOf(1), { ...context, ip: '203.0.113.9' });

      const page = await service.list(uuidOf(1), {
        page: 2,
        limit: 1,
        sortOrder: SortOrder.Asc,
      });

      expect(page.items.map((item) => item.ip)).toEqual(['203.0.113.9']);
      expect(page.meta).toEqual({ total: 2, page: 2, limit: 1, pages: 2 });
    });

    it('counts the distinct accounts per combination, in one query for the page', async () => {
      await service.record(uuidOf(1), context);
      await service.record(uuidOf(2), context);
      await service.record(uuidOf(3), context);
      await service.record(uuidOf(1), { ...context, ip: '203.0.113.9' });
      await service.record(uuidOf(2), { ...context, fingerprint: 'other' });

      const page = await service.list(uuidOf(1), query);

      expect(fake.queryBuilderCalls).toHaveBeenCalledTimes(1);
      expect(
        Object.fromEntries(
          page.items.map((item) => [item.ip, item.seenOnAccounts]),
        ),
      ).toEqual({ '203.0.113.7': 3, '203.0.113.9': 1 });
    });

    it('counts an account once however many times it came back', async () => {
      await service.record(uuidOf(1), context);
      await service.record(uuidOf(1), context);

      const page = await service.list(uuidOf(1), query);

      expect(page.items[0].seenOnAccounts).toBe(1);
    });
  });
});
