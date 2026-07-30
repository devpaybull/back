import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { Role } from '../../common/enums/role.enum';
import { UserSortField } from '../../users/types/user-sort-field.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';

const parse = (query: Record<string, unknown> = {}): ListUsersQueryDto =>
  plainToInstance(ListUsersQueryDto, query);

const failedProperties = (query: Record<string, unknown>): string[] =>
  validateSync(parse(query)).map((error) => error.property);

describe('ListUsersQueryDto', () => {
  it('needs nothing and still describes a whole query', () => {
    expect(failedProperties({})).toEqual([]);
    expect(parse()).toEqual({
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
      sortBy: UserSortField.CreatedAt,
    });
  });

  it('inherits the paging rules of the base query', () => {
    expect(failedProperties({ limit: '101' })).toEqual(['limit']);
    expect(failedProperties({ page: '0' })).toEqual(['page']);
  });

  describe('filters', () => {
    it.each(Object.values(Role))('accepts the role %s', (role) => {
      expect(failedProperties({ role })).toEqual([]);
    });

    it('refuses a role outside the enum', () => {
      expect(failedProperties({ role: 'president' })).toEqual(['role']);
    });

    it.each(Object.values(UserStatus))('accepts the status %s', (status) => {
      expect(failedProperties({ status })).toEqual([]);
    });

    it('refuses a status outside the enum', () => {
      expect(failedProperties({ status: 'on holiday' })).toEqual(['status']);
    });

    it('leaves both filters unset when neither is asked for', () => {
      expect(parse().role).toBeUndefined();
      expect(parse().status).toBeUndefined();
    });
  });

  describe('sortBy', () => {
    it.each([
      UserSortField.Id,
      UserSortField.CreatedAt,
      UserSortField.Role,
      UserSortField.Status,
      UserSortField.Email,
    ])('sorts by %s', (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual([]);
      expect(parse({ sortBy }).sortBy).toBe(sortBy);
    });

    it.each([
      ['passwordHash', 'a column no client may order by'],
      ['telegramUsername', 'a column that is not indexed for sorting'],
      ['totpSecret', 'a secret'],
      ['1; drop table users', 'an injection attempt'],
    ])('refuses %s, being %s', (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual(['sortBy']);
    });
  });
});
