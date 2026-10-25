import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuditLog } from '../entities/audit-log.entity';
import { VictoriaLogsService } from '../services/victoria-logs.service';
import { AuditSource } from '../types/audit-source.enum';

const configWith = (url: string) =>
  ({ get: () => url }) as never as ConstructorParameters<
    typeof VictoriaLogsService
  >[0];

const INSTALLATION_ID = uuidOf(900);
const SCOPE = `installationId:="${INSTALLATION_ID}"`;
const installation = {
  installationId: async () => INSTALLATION_ID,
} as never as ConstructorParameters<typeof VictoriaLogsService>[1];
const victoriaAt = (url: string) =>
  new VictoriaLogsService(configWith(url), installation);

const answer = (status: number, text = '') =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }) as Response;

describe('VictoriaLogsService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async () => answer(200));
    global.fetch = fetchMock as never;
  });

  it('is disabled when no URL is configured', () => {
    expect(victoriaAt('').enabled).toBe(false);
    expect(victoriaAt('http://localhost:9428').enabled).toBe(true);
  });

  describe('insert', () => {
    const row = {
      id: 7,
      source: AuditSource.Http,
      actorUserId: null,
      impersonatorUserId: uuidOf(5),
      targetUserId: uuidOf(1),
      action: 'POST /auth/login',
      reason: null,
      metadata: null,
      method: 'POST',
      path: '/auth/login',
      params: null,
      statusCode: 401,
      ip: '127.0.0.1',
      userAgent: 'probe',
      login: 'who@example.com',
      body: { login: 'who@example.com', password: '[REDACTED]' },
      archivedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    } as AuditLog;

    it('posts NDJSON to the jsonline endpoint with source and the installation as the stream and createdAt as the time', async () => {
      await victoriaAt('http://vl:9428/').insert([
        row,
        { ...row, id: 8 } as AuditLog,
      ]);

      const [url, init] = fetchMock.mock.calls[0];
      const parsed = new URL(url);

      expect(parsed.origin + parsed.pathname).toBe(
        'http://vl:9428/insert/jsonline',
      );
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        _stream_fields: 'source,installationId',
        _time_field: 'createdAt',
        _msg_field: 'message',
      });
      expect(init.method).toBe('POST');

      const lines = (init.body as string)
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));

      expect(lines).toHaveLength(2);
      expect(lines[0]).toEqual({
        installationId: INSTALLATION_ID,
        auditId: 7,
        message: 'POST /auth/login',
        source: 'http',
        actorUserId: null,
        impersonatorUserId: uuidOf(5),
        targetUserId: uuidOf(1),
        action: 'POST /auth/login',
        reason: null,
        metadata: null,
        method: 'POST',
        path: '/auth/login',
        params: null,
        statusCode: 401,
        ip: '127.0.0.1',
        userAgent: 'probe',
        login: 'who@example.com',
        body: '{"login":"who@example.com","password":"[REDACTED]"}',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(lines[1].auditId).toBe(8);
    });

    it('keeps every filtered field as a stored field of its own, not as the message', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(200))
        .mockResolvedValueOnce(answer(200, '{"total":"0"}'))
        .mockResolvedValueOnce(answer(200, '{"total":"0"}'));
      const vl = victoriaAt('http://vl:9428');

      await vl.insert([row]);
      await vl.find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 0,
        targetUserId: uuidOf(1),
        actorUserId: uuidOf(2),
        impersonatorUserId: uuidOf(5),
        action: 'POST /auth/login',
        source: AuditSource.Http,
        statusCode: 401,
      });
      await vl.find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 0,
        actions: ['POST /auth/login'],
      });

      const [insertUrl, insertInit] = fetchMock.mock.calls[0];
      const msgField = new URL(insertUrl).searchParams.get('_msg_field');
      const stored = Object.keys(JSON.parse(insertInit.body as string));
      const filtered = fetchMock.mock.calls
        .slice(1)
        .flatMap(([, init]) =>
          [
            ...(init.body as URLSearchParams)
              .get('query')!
              .matchAll(/(\w+):(?:=|in\()/g),
          ].map((match) => match[1]),
        );

      expect(filtered).toEqual(
        expect.arrayContaining(['action', 'statusCode', 'targetUserId']),
      );
      expect(filtered).not.toContain(msgField);
      for (const field of filtered) expect(stored).toContain(field);
    });

    it('throws on anything but a 2xx', async () => {
      fetchMock.mockResolvedValue(answer(500, 'disk full'));

      await expect(victoriaAt('http://vl:9428').insert([row])).rejects.toThrow(
        /500/,
      );
    });
  });

  describe('find', () => {
    const service = () => victoriaAt('http://vl:9428');
    const queriesSent = (): string[] =>
      fetchMock.mock.calls.map(([, init]) =>
        (init.body as URLSearchParams).get('query'),
      );

    it('counts unique audit ids and pages one row per id, below the Postgres boundary', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(200, '{"total":"42"}\n'))
        .mockResolvedValueOnce(
          answer(
            200,
            [
              JSON.stringify({
                _msg: 'POST /auth/login',
                action: 'POST /auth/login',
                _time: '2026-01-01T00:00:00Z',
                _stream: '{source="http"}',
                auditId: '9',
                source: 'http',
                statusCode: '401',
                login: 'who@example.com',
                body: '{"login":"who@example.com"}',
              }),
              '',
            ].join('\n'),
          ),
        );

      const [rows, total] = await service().find({
        belowId: 100,
        sortOrder: SortOrder.Desc,
        skip: 20,
        take: 10,
        action: 'POST /auth/login',
        statusCode: 401,
      });

      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://vl:9428/select/logsql/query',
      );
      expect(queriesSent()).toEqual([
        `${SCOPE} auditId:<100 action:="POST /auth/login" statusCode:="401" | stats count_uniq(auditId) total`,
        `${SCOPE} auditId:<100 action:="POST /auth/login" statusCode:="401" | sort by (auditId) partition by (auditId) limit 1 | sort by (auditId desc) offset 20 limit 10`,
      ]);
      expect(total).toBe(42);
      expect(rows).toEqual([
        {
          id: 9,
          source: AuditSource.Http,
          actorUserId: null,
          impersonatorUserId: null,
          targetUserId: null,
          action: 'POST /auth/login',
          reason: null,
          metadata: null,
          method: null,
          path: null,
          params: null,
          statusCode: 401,
          ip: null,
          userAgent: null,
          login: 'who@example.com',
          body: { login: 'who@example.com' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
    });

    it('selects every audit row when there is no boundary, and sorts ascending on request', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(200, '{"total":"1"}'))
        .mockResolvedValueOnce(answer(200, ''));

      await service().find({
        belowId: null,
        sortOrder: SortOrder.Asc,
        skip: 0,
        take: 5,
      });

      expect(queriesSent()[1]).toBe(
        `${SCOPE} auditId:>0 | sort by (auditId) partition by (auditId) limit 1 | sort by (auditId) offset 0 limit 5`,
      );
    });

    it('only counts when no rows are wanted', async () => {
      fetchMock.mockResolvedValueOnce(answer(200, '{"total":"3"}'));

      const result = await service().find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 0,
      });

      expect(result).toEqual([[], 3]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('quotes values so they cannot break out of the filter', async () => {
      fetchMock.mockResolvedValueOnce(answer(200, '{"total":"0"}'));

      await service().find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 0,
        action: 'x" | delete',
      });

      expect(queriesSent()[0]).toBe(
        `${SCOPE} auditId:<10 action:="x\\" | delete" | stats count_uniq(auditId) total`,
      );
    });

    it('filters by a list of actions with a quoted in() and the other filters alongside', async () => {
      fetchMock.mockResolvedValueOnce(answer(200, '{"total":"0"}'));

      await service().find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 0,
        targetUserId: uuidOf(1),
        actions: ['activity.device_added', 'x" | delete'],
      });

      expect(queriesSent()[0]).toBe(
        `${SCOPE} auditId:<10 targetUserId:="${uuidOf(1)}" action:in("activity.device_added","x\\" | delete") | stats count_uniq(auditId) total`,
      );
    });

    it('filters by the impersonating superadmin and reads the column back', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(200, '{"total":"1"}'))
        .mockResolvedValueOnce(
          answer(
            200,
            JSON.stringify({
              _msg: 'PATCH /bank-details/:id',
              _time: '2026-01-01T00:00:00Z',
              auditId: '3',
              source: 'http',
              actorUserId: uuidOf(7),
              impersonatorUserId: uuidOf(5),
            }),
          ),
        );

      const [rows] = await service().find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 1,
        impersonatorUserId: uuidOf(5),
      });

      expect(queriesSent()[0]).toBe(
        `${SCOPE} auditId:<10 impersonatorUserId:="${uuidOf(5)}" | stats count_uniq(auditId) total`,
      );
      expect(rows[0]).toMatchObject({
        actorUserId: uuidOf(7),
        impersonatorUserId: uuidOf(5),
      });
    });

    it('reads the action of a row archived before it was stored as a field of its own', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(200, '{"total":"1"}'))
        .mockResolvedValueOnce(
          answer(
            200,
            JSON.stringify({
              _msg: 'POST /auth/logout',
              _time: '2026-01-01T00:00:00Z',
              auditId: '2',
              source: 'http',
            }),
          ),
        );

      const [rows] = await service().find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 1,
      });

      expect(rows[0].action).toBe('POST /auth/logout');
    });

    it('prefers the stored action field over the message', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(200, '{"total":"1"}'))
        .mockResolvedValueOnce(
          answer(
            200,
            JSON.stringify({
              _msg: 'something else',
              action: 'POST /auth/login',
              _time: '2026-01-01T00:00:00Z',
              auditId: '2',
            }),
          ),
        );

      const [rows] = await service().find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 1,
      });

      expect(rows[0].action).toBe('POST /auth/login');
    });

    it('ignores the list when an exact action is given', async () => {
      fetchMock.mockResolvedValueOnce(answer(200, '{"total":"0"}'));

      await service().find({
        belowId: null,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 0,
        action: 'a.one',
        actions: ['a.two'],
      });

      expect(queriesSent()[0]).toBe(
        `${SCOPE} auditId:>0 action:="a.one" | stats count_uniq(auditId) total`,
      );
    });

    it('scopes every count and page query to this installation, so rows archived without one, or by another database, are never read', async () => {
      fetchMock
        .mockResolvedValueOnce(answer(200, '{"total":"1"}'))
        .mockResolvedValueOnce(answer(200, ''))
        .mockResolvedValueOnce(answer(200, '{"total":"1"}'))
        .mockResolvedValueOnce(answer(200, ''));
      const vl = service();

      await vl.find({
        belowId: 10,
        sortOrder: SortOrder.Desc,
        skip: 0,
        take: 5,
        targetUserId: uuidOf(1),
      });
      await vl.find({
        belowId: null,
        sortOrder: SortOrder.Asc,
        skip: 0,
        take: 5,
        actions: ['activity.device_added'],
      });

      expect(queriesSent()).toHaveLength(4);
      for (const query of queriesSent()) {
        expect(query.startsWith(`${SCOPE} `)).toBe(true);
      }
    });

    it('fails without querying when the installation cannot be read', async () => {
      const failing = new VictoriaLogsService(configWith('http://vl:9428'), {
        installationId: async () => {
          throw new Error('database down');
        },
      } as never);

      await expect(
        failing.find({
          belowId: 1,
          sortOrder: SortOrder.Desc,
          skip: 0,
          take: 1,
        }),
      ).rejects.toThrow('database down');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when VictoriaLogs answers with an error', async () => {
      fetchMock.mockResolvedValue(answer(400, 'bad query'));

      await expect(
        service().find({
          belowId: 1,
          sortOrder: SortOrder.Desc,
          skip: 0,
          take: 1,
        }),
      ).rejects.toThrow(/400/);
    });
  });
});
