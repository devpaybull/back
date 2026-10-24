import 'reflect-metadata';
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  INestApplication,
  Injectable,
  InternalServerErrorException,
  Param,
  Post,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsString } from 'class-validator';
import { EventEmitter } from 'events';
import request from 'supertest';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { AuditModule } from '../audit.module';
import { AuditLog } from '../entities/audit-log.entity';
import { HttpAuditMiddleware } from '../middleware/http-audit.middleware';
import { AuditService } from '../services/audit.service';
import { RecordHttpAuditEntry } from '../types/record-http-audit-entry';

class NameDto {
  @IsString()
  name: string;
}

class LoginDto {
  @IsString()
  login: string;

  @IsString()
  password: string;

  @IsString()
  totp: string;
}

@Injectable()
class FakeBearerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (req.path.startsWith('/auth/')) return true;
    if (req.headers.authorization !== 'Bearer ok') {
      throw new UnauthorizedException('Access token is missing');
    }

    req.user = {
      id: uuidOf(9),
      login: 'admin@example.com',
      role: Role.Admin,
      status: UserStatus.Active,
    };

    return true;
  }
}

@Controller()
class ProbeController {
  @Get('things')
  read() {
    return { ok: true };
  }

  @Post('things')
  create(@Body() dto: NameDto) {
    return dto;
  }

  @Post('admin/users/:id/leads')
  addLead(@Param('id') id: string) {
    return { id };
  }

  @Post('boom')
  boom() {
    throw new InternalServerErrorException();
  }

  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    if (dto.password !== 'right') throw new UnauthorizedException();

    return { accessToken: 'x' };
  }
}

describe('HttpAuditMiddleware', () => {
  describe('inside a real Nest application', () => {
    let app: INestApplication;
    let recordHttp: jest.Mock;

    const recorded = async (): Promise<RecordHttpAuditEntry[]> => {
      for (let tick = 0; tick < 50; tick += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      return recordHttp.mock.calls.map(([entry]) => entry);
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({ VICTORIA_LOGS_URL: '' })],
          }),
          AuditModule,
        ],
        controllers: [ProbeController],
        providers: [{ provide: APP_GUARD, useClass: FakeBearerGuard }],
      })
        .overrideProvider(getRepositoryToken(AuditLog))
        .useValue({})
        .overrideProvider(AuditService)
        .useValue({ recordHttp: (recordHttp = jest.fn(async () => ({}))) })
        .compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
    });

    afterAll(() => app.close());

    beforeEach(() => recordHttp.mockClear());

    it('records a successful write with the actor, the route pattern and the target', async () => {
      await request(app.getHttpServer())
        .post(`/admin/users/${uuidOf(1)}/leads?x=1`)
        .set('Authorization', 'Bearer ok')
        .set('User-Agent', 'probe/1.0')
        .send({})
        .expect(201);

      const [entry] = await recorded();

      expect(entry).toEqual({
        actorUserId: uuidOf(9),
        impersonatorUserId: null,
        targetUserId: uuidOf(1),
        action: 'POST /admin/users/:id/leads',
        method: 'POST',
        path: `/admin/users/${uuidOf(1)}/leads`,
        params: { id: uuidOf(1) },
        statusCode: 201,
        ip: expect.any(String),
        userAgent: 'probe/1.0',
        login: null,
        body: {},
      });
    });

    it('records a guard rejection, which happens before any interceptor runs', async () => {
      await request(app.getHttpServer())
        .post('/things')
        .send({ name: 'a' })
        .expect(401);

      const [entry] = await recorded();

      expect(entry).toMatchObject({
        actorUserId: null,
        action: 'POST /things',
        statusCode: 401,
        body: { name: 'a' },
      });
    });

    it('records a validation failure with the body that was refused', async () => {
      await request(app.getHttpServer())
        .post('/things')
        .set('Authorization', 'Bearer ok')
        .send({ name: 5, extra: true })
        .expect(400);

      const [entry] = await recorded();

      expect(entry).toMatchObject({
        actorUserId: uuidOf(9),
        statusCode: 400,
        body: { name: 5, extra: true },
      });
    });

    it('records a server error', async () => {
      await request(app.getHttpServer())
        .post('/boom')
        .set('Authorization', 'Bearer ok')
        .expect(500);

      expect((await recorded())[0]).toMatchObject({
        action: 'POST /boom',
        statusCode: 500,
      });
    });

    it('attributes a failed anonymous login to the login it named, with every secret redacted', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('Authorization', 'Bearer leaked')
        .set('Cookie', 'refresh_token=leaked')
        .send({ login: 'who@example.com', password: 'wrong', totp: '123456' })
        .expect(401);

      const [entry] = await recorded();

      expect(entry).toMatchObject({
        actorUserId: null,
        action: 'POST /auth/login',
        statusCode: 401,
        login: 'who@example.com',
        body: {
          login: 'who@example.com',
          password: '[REDACTED]',
          totp: '[REDACTED]',
        },
      });
      expect(JSON.stringify(entry)).not.toContain('leaked');
    });

    it('does not record reads', async () => {
      await request(app.getHttpServer())
        .get('/things')
        .set('Authorization', 'Bearer ok')
        .expect(200);

      expect(await recorded()).toEqual([]);
    });

    it('does not record a write to a path no route matches', async () => {
      await request(app.getHttpServer())
        .post('/nowhere')
        .set('Authorization', 'Bearer ok')
        .expect(404);

      expect(await recorded()).toEqual([]);
    });

    it('answers normally when the audit write fails', async () => {
      recordHttp.mockRejectedValueOnce(new Error('database is down'));
      const logged = jest
        .spyOn(HttpAuditMiddleware.prototype as never, 'fail' as never)
        .mockImplementation(() => undefined as never);

      await request(app.getHttpServer())
        .post('/things')
        .set('Authorization', 'Bearer ok')
        .send({ name: 'a' })
        .expect(201);

      await recorded();
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });
  });

  describe('in isolation', () => {
    const run = (
      req: Record<string, unknown>,
      recordHttp: jest.Mock = jest.fn(async () => ({})),
    ) => {
      const middleware = new HttpAuditMiddleware({ recordHttp } as never);
      const res = Object.assign(new EventEmitter(), { statusCode: 200 });
      const next = jest.fn();
      const fullReq: Record<string, unknown> = {
        method: 'POST',
        originalUrl: '/x',
        params: {},
        ip: '127.0.0.1',
        get: () => undefined,
        ...req,
        route: undefined,
      };

      middleware.use(fullReq as never, res as never, next);
      fullReq.route = 'route' in req ? req.route : { path: '/x' };
      res.emit('finish');

      return { recordHttp, next };
    };

    it('redacts every secret-looking key at any depth, case-insensitively', () => {
      const { recordHttp } = run({
        body: {
          currentPassword: 'a',
          newPassword: 'b',
          inviteCode: 'c',
          registrationToken: 'd',
          setupToken: 'e',
          backupCode: 'f',
          SECRET: 'g',
          nested: { merchant: { secret: 'h', name: 'kept' } },
          list: [{ totp: '1' }, { amount: 5 }],
          amount: 10,
        },
      });

      expect(recordHttp.mock.calls[0][0].body).toEqual({
        currentPassword: '[REDACTED]',
        newPassword: '[REDACTED]',
        inviteCode: '[REDACTED]',
        registrationToken: '[REDACTED]',
        setupToken: '[REDACTED]',
        backupCode: '[REDACTED]',
        SECRET: '[REDACTED]',
        nested: { merchant: { secret: '[REDACTED]', name: 'kept' } },
        list: [{ totp: '[REDACTED]' }, { amount: 5 }],
        amount: 10,
      });
    });

    it('stores a missing body as null', () => {
      const { recordHttp } = run({ body: undefined });

      expect(recordHttp.mock.calls[0][0].body).toBeNull();
    });

    it('takes no login from the body of an authenticated request', () => {
      const { recordHttp } = run({
        body: { login: 'someone' },
        user: { id: uuidOf(9) },
      });

      expect(recordHttp.mock.calls[0][0]).toMatchObject({
        actorUserId: uuidOf(9),
        login: null,
      });
    });

    it('names the superadmin a login-link session was opened by beside the actor', () => {
      const { recordHttp } = run({
        user: { id: uuidOf(7), impersonatedBy: uuidOf(5) },
      });

      expect(recordHttp.mock.calls[0][0]).toMatchObject({
        actorUserId: uuidOf(7),
        impersonatorUserId: uuidOf(5),
      });
    });

    it('names no impersonator for an ordinary or an anonymous request', () => {
      const ordinary = run({
        user: { id: uuidOf(7), impersonatedBy: null },
      }).recordHttp;
      const anonymous = run({}).recordHttp;

      expect(ordinary.mock.calls[0][0].impersonatorUserId).toBeNull();
      expect(anonymous.mock.calls[0][0].impersonatorUserId).toBeNull();
    });

    it('leaves the target empty when the id is not a uuid or the route is not a user route', () => {
      const first = run({
        route: { path: '/admin/users/:id' },
        params: { id: 'nope' },
      }).recordHttp;
      const second = run({
        route: { path: '/admin/banks/:id' },
        params: { id: uuidOf(1) },
      }).recordHttp;

      expect(first.mock.calls[0][0].targetUserId).toBeNull();
      expect(second.mock.calls[0][0].targetUserId).toBeNull();
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'never subscribes for %s and always calls next',
      (method) => {
        const { recordHttp, next } = run({ method });

        expect(recordHttp).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
      },
    );

    it('swallows a synchronous failure instead of throwing into the response', () => {
      const recordHttp = jest.fn(() => {
        throw new Error('boom');
      });
      const failing = new HttpAuditMiddleware({ recordHttp } as never);
      jest
        .spyOn(failing as never, 'fail' as never)
        .mockImplementation(() => undefined as never);
      const res = Object.assign(new EventEmitter(), { statusCode: 200 });
      const request: Record<string, unknown> = {
        method: 'POST',
        originalUrl: '/x',
        params: {},
        get: () => undefined,
      };

      failing.use(request as never, res as never, jest.fn());
      request.route = { path: '/x' };

      expect(() => res.emit('finish')).not.toThrow();
    });
  });
});
