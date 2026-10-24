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
import { AccountIdentifier } from '../common/types/account-identifier';
import { Page, toPage } from '../common/types/page';
import { AccountMailService } from '../mail/services/account-mail.service';
import { UserDirectoryService } from '../users/services/user-directory.service';
import { Invite } from './entities/invite.entity';
import { CreateInviteInput } from './types/create-invite-input';
import { InviteListQuery } from './types/invite-list-query';
import { InviteStatus, inviteStatus } from './types/invite-status';
import { generateInviteCode } from './utils/generate-invite-code';
import { inviteListOrder } from './utils/invite-list-order';
import { inviteListWhere } from './utils/invite-list-where';
import { normalizeSoleIdentifier } from './utils/normalize-sole-identifier';

const HOUR_IN_MS = 60 * 60 * 1000;

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    @InjectRepository(Invite)
    private readonly invites: Repository<Invite>,
    private readonly directory: UserDirectoryService,
    private readonly mail: AccountMailService,
    private readonly config: ConfigService,
  ) {}

  async create(input: CreateInviteInput): Promise<Invite> {
    const identifier = normalizeSoleIdentifier(input.identifier);

    if (!identifier) {
      throw new BadRequestException(
        'An invite is issued for exactly one of email or telegramUsername',
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
        email: identifier.email ?? null,
        telegramUsername: identifier.telegramUsername ?? null,
        role: input.role,
        code: generateInviteCode(),
        expiresAt: input.expiresAt ?? this.defaultExpiry(),
        createdByUserId: input.createdByUserId,
      }),
    );

    await this.deliver(invite);

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

    const invitedIdentifier: AccountIdentifier = invite.email
      ? { email: invite.email }
      : { telegramUsername: invite.telegramUsername };
    const redeemedBy = normalizeSoleIdentifier(identifier);

    if (
      !redeemedBy ||
      redeemedBy.email !== invitedIdentifier.email ||
      redeemedBy.telegramUsername !== invitedIdentifier.telegramUsername
    ) {
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

    const identifier: AccountIdentifier = invite.email
      ? { email: invite.email }
      : { telegramUsername: invite.telegramUsername };

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
    const issued = await this.invites.find({ where: identifier });

    return (
      issued.find((invite) => inviteStatus(invite) === InviteStatus.Pending) ??
      null
    );
  }

  private async deliver(invite: Invite): Promise<void> {
    if (!invite.email) {
      this.logger.warn(
        `Invite ${invite.id} for @${invite.telegramUsername} has no delivery channel — hand the code over yourself`,
      );

      return;
    }

    try {
      await this.mail.sendInviteCode({
        to: invite.email,
        code: invite.code,
        expiresAt: invite.expiresAt,
      });
    } catch (error) {
      this.logger.error(
        `Invite ${invite.id} was created but could not be emailed to ${invite.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
