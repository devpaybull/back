import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { TokenType } from '../../common/types/token';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { User } from '../../users/entities/user.entity';
import { UserCredentialsService } from '../../users/services/user-credentials.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshToken } from '../entities/refresh-token.entity';
import { LoginContext } from '../types/login-context';
import { IssuedSession, RefreshTokenPayload } from '../types/token-payloads';
import { LoginFootprintService } from './login-footprint.service';
import { loginOf } from '../../common/utils/login-of';

const SECOND_IN_MS = 1000;
const INVALID_CREDENTIALS = 'Invalid login, password or one-time code';
const SESSIONS_REVOKED_ACTION = 'user.sessions_revoked';
const REFRESH_REJECTED = 'Refresh token is invalid or expired';

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly footprints: LoginFootprintService,
    private readonly directory: UserDirectoryService,
    private readonly credentials: UserCredentialsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto, context?: LoginContext): Promise<IssuedSession> {
    const user = await this.directory.findAuthenticatableByLogin(dto.login);

    if (!user || !(await this.credentials.verifyPassword(user, dto.password))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const secondFactorAccepted = await this.credentials.verifySecondFactor(
      user,
      {
        totp: dto.totp,
        backupCode: dto.backupCode,
      },
    );

    if (!secondFactorAccepted) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.issueSession(user, context);
  }

  async refresh(refreshToken: string): Promise<IssuedSession> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(REFRESH_REJECTED);
    }

    if (payload.type !== TokenType.Refresh) {
      throw new UnauthorizedException(REFRESH_REJECTED);
    }

    const stored = await this.refreshTokens.findOne({
      where: { tokenHash: sha256Hex(refreshToken) },
    });

    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException(REFRESH_REJECTED);
    }

    const { affected } = await this.refreshTokens.update(
      { id: stored.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    if (affected !== 1) {
      throw new UnauthorizedException(REFRESH_REJECTED);
    }

    const user = await this.directory.findAuthenticatableById(payload.sub);

    if (!user) {
      throw new UnauthorizedException(REFRESH_REJECTED);
    }

    return this.issueSession(user, undefined, stored.impersonatedByUserId);
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) return;

    await this.refreshTokens.update(
      { tokenHash: sha256Hex(refreshToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllSessions(
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;

    await repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  revokeAllSessionsAudited(userId: string, actorUserId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      await this.revokeAllSessions(userId, manager);
      await this.audit.record(
        {
          actorUserId,
          targetUserId: userId,
          action: SESSIONS_REVOKED_ACTION,
        },
        manager,
      );
    });
  }

  async revokeImpersonationSessions(
    impersonatorUserId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;

    await repository.update(
      { impersonatedByUserId: impersonatorUserId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeImpersonatedSessions(
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;

    await repository.update(
      { userId, impersonatedByUserId: Not(IsNull()), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async findLiveSession(sessionId: number): Promise<RefreshToken | null> {
    const stored = await this.refreshTokens.findOne({
      where: { id: sessionId },
    });

    return stored && !stored.revokedAt && stored.expiresAt > new Date()
      ? stored
      : null;
  }

  async issueSession(
    user: User,
    context?: LoginContext,
    impersonatedByUserId?: string | null,
  ): Promise<IssuedSession> {
    const expiresIn = this.config.get<number>('JWT_ACCESS_TTL_SECONDS');
    const refreshExpiresIn = this.config.get<number>('JWT_REFRESH_TTL_SECONDS');

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID(), type: TokenType.Refresh },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn,
      },
    );

    const session = await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        impersonatedByUserId: impersonatedByUserId ?? null,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresIn * SECOND_IN_MS),
      }),
    );

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        sid: session.id,
        login: loginOf(user),
        role: user.role,
        type: TokenType.Access,
      },
      { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn },
    );

    if (context && !impersonatedByUserId) {
      await this.footprints.record(user.id, context);
    }

    return { accessToken, refreshToken, expiresIn, refreshExpiresIn };
  }
}
