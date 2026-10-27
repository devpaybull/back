import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { TokenType } from '../../common/types/token';
import { renderQrCodeDataUrl } from '../../common/utils/render-qr-code-data-url';
import { toAccountIdentifier } from '../../common/utils/to-account-identifier';
import { InvitesService } from '../../invites/invites.service';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { UserCredentialsService } from '../../users/services/user-credentials.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserEnrolmentService } from '../../users/services/user-enrolment.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { ConfirmRegistrationDto } from '../dto/confirm-registration.dto';
import { ConfirmTwoFactorSetupDto } from '../dto/confirm-two-factor-setup.dto';
import { RegisterDto } from '../dto/register.dto';
import { TwoFactorSetupDto } from '../dto/two-factor-setup.dto';
import {
  IssuedSessionWithBackupCodes,
  StartedRegistrationResult,
  StartedTwoFactorSetupResult,
} from '../types/enrolment';
import {
  RegistrationTokenPayload,
  TwoFactorSetupTokenPayload,
} from '../types/token-payloads';
import { loginOf } from '../../common/utils/login-of';
import { LoginContext } from '../types/login-context';
import { SessionService } from './session.service';

const TWO_FACTOR_SETUP_DENIED = 'Invalid login or password';
const REGISTRATION_TOKEN_REJECTED = 'Registration token is invalid or expired';
const SETUP_TOKEN_REJECTED = 'Two-factor setup token is invalid or expired';

@Injectable()
export class EnrolmentService {
  constructor(
    private readonly directory: UserDirectoryService,
    private readonly credentials: UserCredentialsService,
    private readonly userEnrolment: UserEnrolmentService,
    private readonly invites: InvitesService,
    private readonly merchants: MerchantsService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto): Promise<StartedRegistrationResult> {
    const identifier = toAccountIdentifier(dto.login);
    const invite = await this.invites.assertUsable(dto.inviteCode, identifier);
    const { user, secret, otpauthUrl } =
      await this.userEnrolment.startRegistration({
        identifier,
        role: invite.role,
        password: dto.password,
        merchantId: invite.merchantId,
      });

    const expiresIn = this.config.get<number>('JWT_REGISTRATION_TTL_SECONDS');
    const payload: RegistrationTokenPayload = {
      sub: user.id,
      login: loginOf(user),
      inviteCode: invite.code,
      type: TokenType.Registration,
    };

    return {
      registrationToken: await this.signEnrolmentToken(payload, expiresIn),
      expiresIn,
      otpauthUrl,
      secret,
      qrCode: await renderQrCodeDataUrl(otpauthUrl),
    };
  }

  async confirmRegistration(
    dto: ConfirmRegistrationDto,
    context?: LoginContext,
  ): Promise<IssuedSessionWithBackupCodes> {
    const payload = await this.verifyEnrolmentToken<RegistrationTokenPayload>(
      dto.registrationToken,
      TokenType.Registration,
      REGISTRATION_TOKEN_REJECTED,
    );
    const identifier = toAccountIdentifier(payload.login);

    await this.invites.assertUsable(payload.inviteCode, identifier);

    const backupCodes = await this.userEnrolment.confirmTwoFactor(
      payload.sub,
      dto.totp,
    );
    const user = await this.directory.findAuthenticatableById(payload.sub);

    if (user.role === Role.Merchant && !user.merchantId) {
      await this.dataSource.transaction(async (manager) => {
        const merchant = await this.merchants.create(loginOf(user), manager);

        await this.userEnrolment.attachMerchant(user.id, merchant.id, manager);
      });
    }

    await this.invites.consume(payload.inviteCode, identifier, payload.sub);

    return {
      session: await this.sessions.issueSession(user, context),
      backupCodes,
    };
  }

  async startTwoFactorSetup(
    dto: TwoFactorSetupDto,
  ): Promise<StartedTwoFactorSetupResult> {
    const found = await this.directory.findByLogin(dto.login);

    if (
      !found ||
      !(await this.credentials.verifyPassword(found, dto.password)) ||
      found.status !== UserStatus.PendingTwoFactor
    ) {
      throw new UnauthorizedException(TWO_FACTOR_SETUP_DENIED);
    }

    const { user, secret, otpauthUrl } =
      await this.userEnrolment.startTwoFactorSetup(found.id);

    const expiresIn = this.config.get<number>('JWT_REGISTRATION_TTL_SECONDS');
    const payload: TwoFactorSetupTokenPayload = {
      sub: user.id,
      login: loginOf(user),
      type: TokenType.TwoFactorSetup,
    };

    return {
      setupToken: await this.signEnrolmentToken(payload, expiresIn),
      expiresIn,
      otpauthUrl,
      secret,
      qrCode: await renderQrCodeDataUrl(otpauthUrl),
    };
  }

  async confirmTwoFactorSetup(
    dto: ConfirmTwoFactorSetupDto,
    context?: LoginContext,
  ): Promise<IssuedSessionWithBackupCodes> {
    const payload = await this.verifyEnrolmentToken<TwoFactorSetupTokenPayload>(
      dto.setupToken,
      TokenType.TwoFactorSetup,
      SETUP_TOKEN_REJECTED,
    );

    const backupCodes = await this.userEnrolment.confirmTwoFactor(
      payload.sub,
      dto.totp,
    );

    const user = await this.directory.findAuthenticatableById(payload.sub);

    return {
      session: await this.sessions.issueSession(user, context),
      backupCodes,
    };
  }

  private signEnrolmentToken(
    payload: RegistrationTokenPayload | TwoFactorSetupTokenPayload,
    expiresIn: number,
  ): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_REGISTRATION_SECRET'),
      expiresIn,
    });
  }

  private async verifyEnrolmentToken<T extends { type: TokenType }>(
    token: string,
    expected: TokenType,
    rejection: string,
  ): Promise<T> {
    let payload: T;

    try {
      payload = await this.jwt.verifyAsync<T>(token, {
        secret: this.config.get<string>('JWT_REGISTRATION_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(rejection);
    }

    if (payload.type !== expected) {
      throw new UnauthorizedException(rejection);
    }

    return payload;
  }
}
