import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { InviteSortField } from '../../invites/types/invite-sort-field';
import { InviteStatus } from '../../invites/types/invite-status';
import { ListInvitesQueryDto } from '../dto/list-invites-query.dto';

const parse = (query: Record<string, unknown> = {}): ListInvitesQueryDto =>
  plainToInstance(ListInvitesQueryDto, query);

const failedProperties = (query: Record<string, unknown>): string[] =>
  validateSync(parse(query)).map((error) => error.property);

describe('ListInvitesQueryDto', () => {
  it('needs nothing and still describes a whole query', () => {
    expect(failedProperties({})).toEqual([]);
    expect(parse()).toEqual({
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
      sortBy: InviteSortField.CreatedAt,
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

    it.each(Object.values(InviteStatus))('accepts the status %s', (status) => {
      expect(failedProperties({ status })).toEqual([]);
    });

    it('refuses a status an invite cannot be in', () => {
      expect(failedProperties({ status: 'cancelled' })).toEqual(['status']);
    });
  });

  describe('sortBy', () => {
    it.each([
      InviteSortField.Id,
      InviteSortField.CreatedAt,
      InviteSortField.ExpiresAt,
      InviteSortField.Role,
    ])('sorts by %s', (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual([]);
      expect(parse({ sortBy }).sortBy).toBe(sortBy);
    });

    it.each([
      ['status', 'a status that is computed rather than stored'],
      ['code', 'a column no client may order by'],
      ['usedAt', 'a column outside the agreed set'],
    ])('refuses %s, being %s', (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual(['sortBy']);
    });
  });
});
