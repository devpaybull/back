import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../../audit/services/audit.service';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { LoginLink } from '../entities/login-link.entity';
import { IssuedLoginLink } from '../types/issued-login-link';
import { LOGIN_LINK_PROTECTED_ROLES } from '../types/login-link-protected-roles';
import { IssuedSession } from '../types/token-payloads';
import { SessionService } from './session.service';

const MINUTE_IN_MS = 60 * 1000;
const CODE_BYTES = 32;
const LOGIN_LINK_PAGE_PATH = '/login-link';
const LOGIN_LINK_REJECTED = 'Login link is invalid, used or expired';

const ISSUE_LOCK_QUERY = 'SELECT pg_advisory_xact_lock(hashtext($1))';
const LOGIN_LINK_ISSUED_ACTION = 'user.login_link_issued';
const LOGIN_LINK_USED_ACTION = 'user.login_link_used';

@Injectable()
export class LoginLinkService {
  constructor(
    @InjectRepository(LoginLink)
    private readonly links: Repository<LoginLink>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly directory: UserDirectoryService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  async issue(
    userId: string,
    issuedByUserId: string,
  ): Promise<IssuedLoginLink> {
    const code = randomBytes(CODE_BYTES).toString('base64url');
    const expiresAt = new Date(
      Date.now() +
        this.config.get<number>('LOGIN_LINK_TTL_MINUTES') * MINUTE_IN_MS,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.query(ISSUE_LOCK_QUERY, [userId]);
      await manager.delete(LoginLink, { userId, usedAt: IsNull() });

      const link = await manager.save(
        manager.create(LoginLink, {
          userId,
          issuedByUserId,
          codeHash: sha256Hex(code),
          expiresAt,
          usedAt: null,
        }),
      );

      await this.audit.record(
        {
          actorUserId: issuedByUserId,
          targetUserId: userId,
          action: LOGIN_LINK_ISSUED_ACTION,
          metadata: {
            loginLinkId: link.id,
            expiresAt: expiresAt.toISOString(),
          },
        },
        manager,
      );
    });

    const appUrl = this.config.get<string>('APP_URL');
    const url = appUrl
      ? `${appUrl.replace(/\/+$/, '')}${LOGIN_LINK_PAGE_PATH}#${new URLSearchParams({ code }).toString()}`
      : null;

    return { code, url, expiresAt };
  }

  async invalidateIssuedBy(issuedByUserId: string): Promise<void> {
    await this.links.delete({ issuedByUserId, usedAt: IsNull() });
  }

  async redeem(code: string): Promise<IssuedSession> {
    const link = await this.links.findOne({
      where: { codeHash: sha256Hex(code) },
    });
    const now = new Date();

    if (!link || link.usedAt || link.expiresAt <= now) {
      throw new UnauthorizedException(LOGIN_LINK_REJECTED);
    }

    const user = await this.directory.findAuthenticatableById(link.userId);

    if (!user || LOGIN_LINK_PROTECTED_ROLES.includes(user.role)) {
      throw new UnauthorizedException(LOGIN_LINK_REJECTED);
    }

    const issuer = await this.directory.findAuthenticatableById(
      link.issuedByUserId,
    );

    if (
      issuer?.role !== Role.Superadmin ||
      issuer.status !== UserStatus.Active
    ) {
      throw new UnauthorizedException(LOGIN_LINK_REJECTED);
    }

    await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager.update(
        LoginLink,
        { id: link.id, usedAt: IsNull(), expiresAt: MoreThan(now) },
        { usedAt: now },
      );

      if (affected !== 1) {
        throw new UnauthorizedException(LOGIN_LINK_REJECTED);
      }

      await this.audit.record(
        {
          actorUserId: user.id,
          targetUserId: user.id,
          action: LOGIN_LINK_USED_ACTION,
          metadata: {
            loginLinkId: link.id,
            issuedByUserId: link.issuedByUserId,
          },
        },
        manager,
      );
    });

    return this.sessions.issueSession(user, undefined, link.issuedByUserId);
  }
}
