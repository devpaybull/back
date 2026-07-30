import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { TokenType } from '../../common/types/token';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { User } from '../../users/entities/user.entity';
import { UserCredentialsService } from '../../users/services/user-credentials.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshToken } from '../entities/refresh-token.entity';
import { IssuedSession, RefreshTokenPayload } from '../types/token-payloads';
import { loginOf } from '../utils/login-of';

const SECOND_IN_MS = 1000;
const INVALID_CREDENTIALS = 'Invalid email, password or one-time code';
const REFRESH_REJECTED = 'Refresh token is invalid or expired';

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly directory: UserDirectoryService,
    private readonly credentials: UserCredentialsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<IssuedSession> {
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

    return this.issueSession(user);
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

    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);

    const user = await this.directory.findAuthenticatableById(payload.sub);

    if (!user) {
      throw new UnauthorizedException(REFRESH_REJECTED);
    }

    return this.issueSession(user);
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) return;

    await this.refreshTokens.update(
      { tokenHash: sha256Hex(refreshToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.refreshTokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async isSessionLive(sessionId: number): Promise<boolean> {
    const stored = await this.refreshTokens.findOne({
      where: { id: sessionId },
    });

    return Boolean(
      stored && !stored.revokedAt && stored.expiresAt > new Date(),
    );
  }

  async issueSession(user: User): Promise<IssuedSession> {
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

    return { accessToken, refreshToken, expiresIn, refreshExpiresIn };
  }
}
