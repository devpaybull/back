import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AuditSortField } from '../../audit/types/audit-sort-field.enum';
import { AuditSource } from '../../audit/types/audit-source.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { ListAllAuditQueryDto } from '../dto/list-all-audit-query.dto';

const parse = (query: Record<string, unknown> = {}): ListAllAuditQueryDto =>
  plainToInstance(ListAllAuditQueryDto, query);

const failedProperties = (query: Record<string, unknown>): string[] =>
  validateSync(parse(query)).map((error) => error.property);

describe('ListAllAuditQueryDto', () => {
  it('needs nothing and still describes a whole query', () => {
    expect(failedProperties({})).toEqual([]);
    expect(parse()).toEqual({
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
      sortBy: AuditSortField.CreatedAt,
    });
  });

  it('inherits the paging rules of the base query', () => {
    expect(failedProperties({ limit: '101' })).toEqual(['limit']);
  });

  it('accepts every filter together and types the status code as a number', () => {
    const query = {
      targetUserId: uuidOf(1),
      actorUserId: uuidOf(2),
      impersonatorUserId: uuidOf(3),
      action: 'POST /admin/users/:id/leads',
      source: AuditSource.Http,
      statusCode: '403',
    };

    expect(failedProperties(query)).toEqual([]);
    expect(parse(query).statusCode).toBe(403);
  });

  it.each([
    ['targetUserId', 'not-a-uuid'],
    ['actorUserId', '42'],
    ['impersonatorUserId', 'nobody'],
    ['source', 'cron'],
    ['statusCode', '99'],
    ['statusCode', '600'],
    ['statusCode', 'abc'],
    ['action', 'x'.repeat(301)],
  ])('refuses %s=%s', (field, value) => {
    expect(failedProperties({ [field]: value })).toEqual([field]);
  });

  it.each(Object.values(AuditSortField))('sorts by %s', (sortBy) => {
    expect(failedProperties({ sortBy })).toEqual([]);
  });

  it('refuses any other sort field', () => {
    expect(failedProperties({ sortBy: 'statusCode' })).toEqual(['sortBy']);
  });
});
