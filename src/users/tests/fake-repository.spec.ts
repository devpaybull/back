import { randomUUID } from 'crypto';
import { FindOperator, ILike, In, IsNull, Not } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';

type Row = Record<string, any>;

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const likeExpression = (pattern: string): RegExp => {
  let expression = '';
  let index = 0;

  while (index < pattern.length) {
    const character = pattern[index];

    if (character === '\\' && index + 1 < pattern.length) {
      expression += escapeRegExp(pattern[index + 1]);
      index += 2;
      continue;
    }

    expression +=
      character === '%'
        ? '.*'
        : character === '_'
          ? '.'
          : escapeRegExp(character);
    index += 1;
  }

  return new RegExp(`^${expression}$`, 'i');
};

const matchesValue = (actual: unknown, expected: unknown): boolean => {
  if (!(expected instanceof FindOperator)) return actual === expected;

  if (expected.type === 'in')
    return (expected.value as unknown[]).includes(actual);

  if (expected.type === 'not')
    return !matchesValue(actual, expected.child ?? expected.value);

  if (expected.type === 'isNull') return actual === null;

  if (expected.type === 'ilike')
    return (
      typeof actual === 'string' &&
      likeExpression(expected.value as string).test(actual)
    );

  throw new Error(`unsupported find operator: ${expected.type}`);
};

const matchesCondition = (row: Row, condition: Row): boolean =>
  Object.entries(condition).every(([field, value]) =>
    matchesValue(row[field], value),
  );

const matchesWhere = (row: Row, where: unknown): boolean =>
  (Array.isArray(where) ? where : [where]).some((condition) =>
    matchesCondition(row, condition as Row),
  );

const sortValue = (value: unknown): any =>
  value instanceof Date ? value.getTime() : value;

const compare = (one: unknown, other: unknown): number => {
  const first = sortValue(one);
  const second = sortValue(other);

  if (first === second) return 0;
  if (first === null || first === undefined) return -1;
  if (second === null || second === undefined) return 1;

  return first < second ? -1 : 1;
};

const byOrder =
  (order: Record<string, 'ASC' | 'DESC'>) =>
  (one: Row, other: Row): number => {
    for (const [field, direction] of Object.entries(order ?? {})) {
      const result = compare(one[field], other[field]);

      if (result !== 0) return direction === 'ASC' ? result : -result;
    }

    return 0;
  };

export interface FakeRepository {
  find: jest.Mock;
  findOne: jest.Mock;
  findAndCount: jest.Mock;
  create: jest.Mock;
  merge: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
}

export const createFakeRepository = (rows: Row[]): FakeRepository => {
  return {
    find: jest.fn(async ({ where }: { where: unknown }) =>
      rows.filter((row) => matchesWhere(row, where)),
    ),
    findOne: jest.fn(
      async ({ where }: { where: unknown }) =>
        rows.find((row) => matchesWhere(row, where)) ?? null,
    ),
    findAndCount: jest.fn(
      async ({
        where,
        order,
        skip = 0,
        take,
      }: {
        where: unknown;
        order: Record<string, 'ASC' | 'DESC'>;
        skip?: number;
        take?: number;
      }) => {
        const matched = rows
          .filter((row) => matchesWhere(row, where))
          .sort(byOrder(order));

        return [
          matched.slice(skip, take === undefined ? undefined : skip + take),
          matched.length,
        ];
      },
    ),
    create: jest.fn((data: Row = {}) => ({ ...data })),
    merge: jest.fn((target: Row, patch: Row) => Object.assign(target, patch)),
    save: jest.fn(async (entity: Row | Row[]) => {
      const saved = (Array.isArray(entity) ? entity : [entity]).map((one) => {
        if (rows.includes(one)) return one;

        const created = { ...one, id: one.id ?? randomUUID() };
        rows.push(created);

        return created;
      });

      return Array.isArray(entity) ? saved : saved[0];
    }),
    delete: jest.fn(async (criteria: Row) => {
      const remaining = rows.filter((row) => !matchesCondition(row, criteria));
      const affected = rows.length - remaining.length;

      rows.splice(0, rows.length, ...remaining);

      return { affected, raw: [] };
    }),
  };
};

describe('the fake repository the users tests run against', () => {
  let rows: Row[];
  let repository: FakeRepository;

  beforeEach(() => {
    rows = [
      {
        id: uuidOf(1),
        email: 'anna@example.com',
        status: 'active',
        usedAt: null,
      },
      {
        id: uuidOf(2),
        email: 'boris@example.com',
        status: 'blocked',
        usedAt: null,
      },
      { id: uuidOf(3), email: 'discount100%@example.com', status: 'active' },
    ];
    repository = createFakeRepository(rows);
  });

  it('matches a plain equality condition', async () => {
    await expect(
      repository.findOne({ where: { id: uuidOf(2) } }),
    ).resolves.toBe(rows[1]);
  });

  it('finds every row an In condition names', async () => {
    await expect(
      repository.find({ where: { id: In([uuidOf(1), uuidOf(3)]) } }),
    ).resolves.toEqual([rows[0], rows[2]]);
  });

  it('takes any of the conditions when the where is a list', async () => {
    await expect(
      repository.findOne({
        where: [
          { email: 'nobody@example.com' },
          { email: 'boris@example.com' },
        ],
      }),
    ).resolves.toBe(rows[1]);
  });

  it('answers null when nothing matches', async () => {
    await expect(
      repository.findOne({ where: { id: uuidOf(404) } }),
    ).resolves.toBeNull();
  });

  it('understands the operators the services use', async () => {
    await expect(
      repository.findOne({ where: { status: In(['blocked']) } }),
    ).resolves.toBe(rows[1]);
    await expect(
      repository.findOne({ where: { status: Not('active') } }),
    ).resolves.toBe(rows[1]);
    await expect(
      repository.findOne({ where: { id: uuidOf(1), usedAt: IsNull() } }),
    ).resolves.toBe(rows[0]);
    await expect(
      repository.findOne({ where: { email: ILike('%BORIS%') } }),
    ).resolves.toBe(rows[1]);
  });

  it('reads an escaped wildcard as text', async () => {
    await expect(
      repository.findOne({ where: { email: ILike('%100\\%%') } }),
    ).resolves.toBe(rows[2]);
  });

  it('orders, pages and counts every match', async () => {
    const [page, total] = await repository.findAndCount({
      where: { status: 'active' },
      order: { id: 'DESC' },
      skip: 1,
      take: 1,
    });

    expect(page.map((row: Row) => row.id)).toEqual([uuidOf(1)]);
    expect(total).toBe(2);
  });

  it('adds a new row and leaves a known one in place', async () => {
    const created = await repository.save(
      repository.create({ email: 'new@example.com' }),
    );

    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.id)).size).toBe(4);
    expect(created.id).toBeDefined();

    const known = await repository.save(
      repository.merge(rows[0], { status: 'suspended' }),
    );

    expect(known).toBe(rows[0]);
    expect(rows).toHaveLength(4);
  });

  it('deletes every row the criteria match', async () => {
    await repository.delete({ status: 'active' });

    expect(rows.map((row) => row.id)).toEqual([uuidOf(2)]);
  });
});
