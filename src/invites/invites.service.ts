import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { AccountIdentifier } from '../common/types/account-identifier';
import { Page, toPage } from '../common/types/page';
import { normalizeTelegramUsername } from '../common/utils/normalize-telegram-username';
import { MerchantsService } from '../merchants/merchants.service';
import { UserDirectoryService } from '../users/services/user-directory.service';
import { Invite } from './entities/invite.entity';
import { CreateInviteInput } from './types/create-invite-input';
import { InviteListQuery } from './types/invite-list-query';
import { InviteStatus, inviteStatus } from './types/invite-status';
import { generateInviteCode } from './utils/generate-invite-code';
import { inviteListOrder } from './utils/invite-list-order';
import { inviteListWhere } from './utils/invite-list-where';

const HOUR_IN_MS = 60 * 60 * 1000;

const MERCHANT_STAFF_ROLES: Role[] = [Role.MerchantSupport, Role.MerchantAgent];

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    @InjectRepository(Invite)
    private readonly invites: Repository<Invite>,
    private readonly directory: UserDirectoryService,
    private readonly merchants: MerchantsService,
    private readonly config: ConfigService,
  ) {}

  async create(input: CreateInviteInput): Promise<Invite> {
    const telegramUsername = normalizeTelegramUsername(
      input.telegramUsername ?? '',
    );

    if (!telegramUsername) {
      throw new BadRequestException(
        'An invite is issued for a telegramUsername',
      );
    }

    const identifier: AccountIdentifier = { telegramUsername };

    if (MERCHANT_STAFF_ROLES.includes(input.role)) {
      if (!input.merchantId) {
        throw new BadRequestException(
          `A ${input.role} invite needs a merchantId`,
        );
      }

      if (!(await this.merchants.findById(input.merchantId))) {
        throw new BadRequestException('Merchant not found');
      }
    } else if (input.merchantId) {
      throw new BadRequestException(
        `A ${input.role} invite cannot carry a merchantId`,
      );
    }

    if (await this.directory.isIdentifierTaken(identifier)) {
      throw new ConflictException('This account already exists');
    }

    if (await this.findLiveInvite(identifier)) {
      throw new ConflictException(
        'A usable invite has already been issued for this account',
      );
    }

    const invite = await this.invites.save(
      this.invites.create({
        telegramUsername,
        role: input.role,
        merchantId: input.merchantId ?? null,
        code: generateInviteCode(),
        expiresAt: input.expiresAt ?? this.defaultExpiry(),
        createdByUserId: input.createdByUserId,
      }),
    );

    this.logger.warn(
      `Invite ${invite.id} for @${invite.telegramUsername} has no delivery channel — hand the code over yourself`,
    );

    return this.invites.findOne({
      where: { id: invite.id },
      relations: { createdBy: true },
    });
  }

  async list(query: InviteListQuery): Promise<Page<Invite>> {
    return toPage(
      await this.invites.findAndCount({
        where: inviteListWhere(query),
        order: inviteListOrder(query),
        relations: { createdBy: true, usedBy: true, revokedBy: true },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async assertUsable(
    code: string,
    identifier: AccountIdentifier,
  ): Promise<Invite> {
    const invite = await this.invites.findOne({
      where: { code: code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() },
    });

    if (!invite || inviteStatus(invite) !== InviteStatus.Pending) {
      throw new BadRequestException('Invite code is invalid, used or expired');
    }

    const redeemedBy =
      identifier?.email || !identifier?.telegramUsername
        ? null
        : normalizeTelegramUsername(identifier.telegramUsername);

    if (!redeemedBy || redeemedBy !== invite.telegramUsername) {
      throw new ForbiddenException(
        'Invite code was issued for another account',
      );
    }

    return invite;
  }

  async consume(
    code: string,
    identifier: AccountIdentifier,
    userId: string,
  ): Promise<Invite> {
    const invite = await this.assertUsable(code, identifier);

    invite.usedAt = new Date();
    invite.usedByUserId = userId;

    return this.invites.save(invite);
  }

  async findById(id: number): Promise<Invite> {
    return this.invites.findOne({ where: { id } });
  }

  async revoke(id: number, revokedByUserId: string): Promise<Invite> {
    const invite = await this.findById(id);

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    const status = inviteStatus(invite);

    if (status === InviteStatus.Used) {
      throw new ConflictException('This invite has already been used');
    }

    if (status === InviteStatus.Revoked) {
      throw new ConflictException('This invite has already been revoked');
    }

    invite.revokedAt = new Date();
    invite.revokedByUserId = revokedByUserId;

    await this.invites.save(invite);

    return this.invites.findOne({
      where: { id },
      relations: { createdBy: true, usedBy: true, revokedBy: true },
    });
  }

  async extend(id: number, expiresAt: Date): Promise<Invite> {
    const invite = await this.findById(id);

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    const status = inviteStatus(invite);

    if (status === InviteStatus.Used) {
      throw new ConflictException('This invite has already been used');
    }

    if (status === InviteStatus.Revoked) {
      throw new ConflictException('This invite has been revoked');
    }

    if (!invite.telegramUsername) {
      throw new ConflictException('This invite can no longer be redeemed');
    }

    const identifier: AccountIdentifier = {
      telegramUsername: invite.telegramUsername,
    };

    if (await this.directory.isIdentifierTaken(identifier)) {
      throw new ConflictException('This account already exists');
    }

    if (status === InviteStatus.Expired) {
      if (await this.findLiveInvite(identifier)) {
        throw new ConflictException(
          'A usable invite has already been issued for this account',
        );
      }
    }

    invite.expiresAt = expiresAt;

    await this.invites.save(invite);

    return this.invites.findOne({
      where: { id },
      relations: { createdBy: true, usedBy: true, revokedBy: true },
    });
  }

  private defaultExpiry(): Date {
    return new Date(
      Date.now() + this.config.get<number>('INVITE_TTL_HOURS') * HOUR_IN_MS,
    );
  }

  private async findLiveInvite(identifier: AccountIdentifier): Promise<Invite> {
    if (!identifier.email && !identifier.telegramUsername) return null;

    const issued = await this.invites.find({ where: identifier });

    return (
      issued.find((invite) => inviteStatus(invite) === InviteStatus.Pending) ??
      null
    );
  }
}
