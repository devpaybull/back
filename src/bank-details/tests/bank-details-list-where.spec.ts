import { FindOperator, FindOptionsWhere } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankDetailsType } from '../types/bank-details-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { BankDetails } from '../entities/bank-details.entity';
import { BankDetailsListQuery } from '../types/bank-details-list-query';
import { BankDetailsSortField } from '../types/bank-details-sort-field';
import { bankDetailsListWhere } from '../utils/bank-details-list-where';
import { BankDetailsStatus } from '../types/bank-details-status.enum';
import { IsNull, Not } from 'typeorm';

const query = (
  overrides: Partial<BankDetailsListQuery> = {},
): BankDetailsListQuery => ({
  page: 1,
  limit: 20,
  sortBy: BankDetailsSortField.CreatedAt,
  sortOrder: SortOrder.Desc,
  ...overrides,
});

const branches = (
  where: FindOptionsWhere<BankDetails> | FindOptionsWhere<BankDetails>[],
): FindOptionsWhere<BankDetails>[] => (Array.isArray(where) ? where : [where]);

describe('bankDetailsListWhere', () => {
  it('asks for everything when nothing was filtered', () => {
    expect(bankDetailsListWhere(query())).toEqual({});
  });

  it('scopes to one owner, which is what keeps a trader off other rows', () => {
    expect(bankDetailsListWhere(query({ userId: uuidOf(1) }))).toEqual({
      userId: uuidOf(1),
    });
  });

  it('keeps a false filter, which is not the same as an absent one', () => {
    expect(bankDetailsListWhere(query({ active: false }))).toEqual({
      active: false,
    });
  });

  it('filters by bank and by type', () => {
    expect(
      bankDetailsListWhere(
        query({ bankId: 2, type: BankDetailsType.CardOrSbp }),
      ),
    ).toEqual({ bankId: 2, type: BankDetailsType.CardOrSbp });
  });

  describe('the banned filter, which has no column of its own', () => {
    it('turns banned=true into "bannedAt is set"', () => {
      const where = bankDetailsListWhere(
        query({ banned: true }),
      ) as FindOptionsWhere<BankDetails>;
      const condition = where.bannedAt as unknown as FindOperator<Date>;

      const negated = (condition.child ??
        condition.value) as FindOperator<Date>;

      expect(condition.type).toBe('not');
      expect(negated.type).toBe('isNull');
    });

    it('turns banned=false into "bannedAt is null"', () => {
      const where = bankDetailsListWhere(
        query({ banned: false }),
      ) as FindOptionsWhere<BankDetails>;
      const condition = where.bannedAt as unknown as FindOperator<Date>;

      expect(condition.type).toBe('isNull');
    });

    it('leaves bannedAt alone when the filter is absent', () => {
      expect(bankDetailsListWhere(query())).not.toHaveProperty('bannedAt');
    });
  });

  describe('search', () => {
    it('looks in card and phone, one branch each', () => {
      const found = branches(bankDetailsListWhere(query({ search: '4400' })));

      expect(found).toHaveLength(2);
      expect(found.map((branch) => Object.keys(branch)[0])).toEqual([
        'card',
        'phone',
      ]);
    });

    it('escapes the wildcards so a search for 100% is not every row', () => {
      const [first] = branches(bankDetailsListWhere(query({ search: '1_0%' })));
      const condition = first.card as unknown as FindOperator<string>;

      expect(condition.type).toBe('ilike');
      expect(condition.value).toBe('%1\\_0\\%%');
    });

    it('carries the owner scope into every branch of the search', () => {
      const found = branches(
        bankDetailsListWhere(query({ search: '4400', userId: uuidOf(1) })),
      );

      for (const branch of found) {
        expect(branch).toMatchObject({ userId: uuidOf(1) });
      }
    });
  });
});

describe('bankDetailsListWhere, the owner’s status and tag', () => {
  it.each([
    [BankDetailsStatus.Active, { active: true, bannedAt: IsNull() }],
    [BankDetailsStatus.Disabled, { active: false, bannedAt: IsNull() }],
    [BankDetailsStatus.Banned, { bannedAt: Not(IsNull()) }],
  ])('translates status %s into columns', (status, expected) => {
    expect(bankDetailsListWhere(query({ status }))).toEqual(expected);
  });

  it('filters by a tag through the link table', () => {
    expect(bankDetailsListWhere(query({ tagId: 7 }))).toEqual({
      tagLinks: { tagId: 7 },
    });
  });

  it('keeps the tag in every search branch', () => {
    for (const branch of branches(
      bankDetailsListWhere(query({ tagId: 7, search: '4400' })),
    )) {
      expect(branch.tagLinks).toEqual({ tagId: 7 });
    }
  });
});
