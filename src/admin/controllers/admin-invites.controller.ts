import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AccountIdentifier } from '../../common/types/account-identifier';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { InvitesService } from '../../invites/invites.service';
import { Invite } from '../../invites/entities/invite.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { RateService } from '../../transactions/services/rate.service';
import { RateScope } from '../../transactions/types/rate-scope.enum';
import { CreateInviteDto } from '../dto/create-invite.dto';
import { ExtendInviteDto } from '../dto/extend-invite.dto';
import { InviteDto, toInviteDto } from '../dto/invite.dto';
import { ListInvitesQueryDto } from '../dto/list-invites-query.dto';
import { InviteTerms } from '../types/invite-terms';
import { canIssueRole } from '../utils/can-issue-role';

@ApiTags('Admin · Invites')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/invites')
export class AdminInvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly rates: RateService,
    private readonly traderSettings: TraderSettingsService,
  ) {}

  private async withTerms(invites: Invite[]): Promise<InviteDto[]> {
    const hasTerms = (invite: Invite): boolean =>
      invite.role === Role.Trader && !(invite.usedAt && !invite.usedByUserId);
    const userIds = [
      ...new Set(
        invites
          .filter(hasTerms)
          .map((invite) => invite.usedByUserId)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ];
    const noTerms: InviteTerms = { rates: null, insurancePayInMin: null };

    if (!invites.some(hasTerms)) {
      return invites.map((invite) => toInviteDto(invite, noTerms));
    }

    const settingsByUser = new Map(
      (await this.traderSettings.findByUserIds(userIds)).map((settings) => [
        settings.userId,
        settings,
      ]),
    );
    const effective = await this.rates.getEffectiveGeneralRates(
      RateScope.Trader,
      userIds.map((userId) => ({
        userId,
        individualEnabled:
          settingsByUser.get(userId)?.individualRatesEnabled ?? false,
      })),
    );

    return invites.map((invite) => {
      if (!hasTerms(invite)) return toInviteDto(invite, noTerms);

      const userId = invite.usedByUserId;

      return toInviteDto(invite, {
        rates: (userId && effective.bySubject.get(userId)) || effective.base,
        insurancePayInMin: this.traderSettings.insurancePayInMinOf(
          userId ? settingsByUser.get(userId) : null,
        ),
      });
    });
  }

  @Post()
  @WriteAccess()
  @ApiOperation({
    summary: 'Issues an invite code for a role and sends it out',
  })
  @ApiEnvelopeResponse(InviteDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateInviteDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<InviteDto> {
    if (!canIssueRole(admin.role, dto.role)) {
      throw new ForbiddenException(`Cannot issue the role ${dto.role}`);
    }

    const identifier: AccountIdentifier = {};

    if (dto.email !== undefined) identifier.email = dto.email;

    if (dto.telegramUsername !== undefined) {
      identifier.telegramUsername = dto.telegramUsername;
    }

    const created = await this.invites.create({
      identifier,
      role: dto.role,
      createdByUserId: admin.id,
      expiresAt: dto.expiresAt,
    });

    return (await this.withTerms([created]))[0];
  }

  @Get()
  @ApiOperation({ summary: 'Lists issued invite codes' })
  @ApiPagedResponse(InviteDto)
  async list(@Query() query: ListInvitesQueryDto): Promise<Page<InviteDto>> {
    const page = await this.invites.list(query);
    const dtos = await this.withTerms(page.items);

    return new Page(dtos, page.meta);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: 'Kills an invite code that has not been redeemed yet',
  })
  @ApiEnvelopeResponse(InviteDto)
  async revoke(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<InviteDto> {
    const invite = await this.invites.findById(id);

    if (!invite) throw new NotFoundException('Invite not found');

    if (!canIssueRole(admin.role, invite.role)) {
      throw new ForbiddenException(`Cannot revoke a ${invite.role} invite`);
    }

    const revoked = await this.invites.revoke(id, admin.id);

    return (await this.withTerms([revoked]))[0];
  }

  @Post(':id/extend')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: 'Moves the expiry of an invite code that has not been redeemed',
  })
  @ApiEnvelopeResponse(InviteDto)
  async extend(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExtendInviteDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<InviteDto> {
    const invite = await this.invites.findById(id);

    if (!invite) throw new NotFoundException('Invite not found');

    if (!canIssueRole(admin.role, invite.role)) {
      throw new ForbiddenException(`Cannot extend a ${invite.role} invite`);
    }

    const extended = await this.invites.extend(id, dto.expiresAt);

    return (await this.withTerms([extended]))[0];
  }
}
