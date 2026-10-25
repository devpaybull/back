import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LoginLinkService } from '../../auth/services/login-link.service';
import { LOGIN_LINK_PROTECTED_ROLES } from '../../auth/types/login-link-protected-roles';
import { PasswordService } from '../../auth/services/password.service';
import { SessionService } from '../../auth/services/session.service';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { MerchantsService } from '../../merchants/merchants.service';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { RateService } from '../../transactions/services/rate.service';
import { WalletService } from '../../transactions/services/wallet.service';
import { EffectiveGeneralRates } from '../../transactions/types/effective-general-rates';
import { RateScope } from '../../transactions/types/rate-scope.enum';
import { User } from '../../users/entities/user.entity';
import { UserAdministrationService } from '../../users/services/user-administration.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserEnrolmentService } from '../../users/services/user-enrolment.service';
import { UserTeamService } from '../../users/services/user-team.service';
import { AUTHENTICATABLE_STATUSES } from '../../users/types/authenticatable-statuses';
import { UserStatus } from '../../users/types/user-status.enum';
import { AddLeadDto } from '../dto/add-lead.dto';
import { toBalancesDto } from '../dto/balances.dto';
import { GeneratedPasswordDto } from '../dto/generated-password.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { LoginLinkDto } from '../dto/login-link.dto';
import { TeamMemberDto } from '../dto/team-member.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { toUserDto, UserDto } from '../dto/user.dto';
import { toUserListItemDto, UserListItemDto } from '../dto/user-list-item.dto';
import { canIssueRole } from '../utils/can-issue-role';

const MERCHANT_ROLES: Role[] = [
  Role.Merchant,
  Role.MerchantSupport,
  Role.MerchantAgent,
];

@ApiTags('Admin · Users')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly directory: UserDirectoryService,
    private readonly administration: UserAdministrationService,
    private readonly enrolment: UserEnrolmentService,
    private readonly sessions: SessionService,
    private readonly team: UserTeamService,
    private readonly wallets: WalletService,
    private readonly traderSettings: TraderSettingsService,
    private readonly rates: RateService,
    private readonly merchants: MerchantsService,
    private readonly passwords: PasswordService,
    private readonly loginLinks: LoginLinkService,
  ) {}

  private async withDetails(users: User[]): Promise<UserListItemDto[]> {
    const idsWithRole = (role: Role): string[] =>
      users.filter((user) => user.role === role).map((user) => user.id);
    const traderIds = idsWithRole(Role.Trader);
    const leadIds = idsWithRole(Role.LeadTrader);
    const tradingIds = [...traderIds, ...leadIds];
    const merchantIds = [
      ...new Set(
        users
          .filter((user) => MERCHANT_ROLES.includes(user.role))
          .map((user) => user.merchantId)
          .filter((merchantId): merchantId is string => Boolean(merchantId)),
      ),
    ];

    const [wallets, settings, leads, subordinates, merchants] =
      await Promise.all([
        this.wallets.findByUserIds(tradingIds),
        this.traderSettings.findByUserIds(tradingIds),
        this.team.leadsOf(traderIds),
        this.team.subordinatesOf(leadIds),
        this.merchants.findByIds(merchantIds),
      ]);
    const walletByUser = new Map(
      wallets.map((wallet) => [wallet.userId, wallet]),
    );
    const settingsByUser = new Map(settings.map((row) => [row.userId, row]));
    const merchantById = new Map(
      merchants.map((merchant) => [merchant.id, merchant]),
    );
    const traderRates: EffectiveGeneralRates | null = traderIds.length
      ? await this.rates.getEffectiveGeneralRates(
          RateScope.Trader,
          traderIds.map((userId) => ({
            userId,
            individualEnabled:
              settingsByUser.get(userId)?.individualRatesEnabled ?? false,
          })),
        )
      : null;

    return users.map((user) => {
      const isTrader = user.role === Role.Trader;
      const isLead = user.role === Role.LeadTrader;
      const rates = isTrader ? traderRates : null;
      const wallet = isTrader || isLead ? walletByUser.get(user.id) : null;
      const merchant = MERCHANT_ROLES.includes(user.role)
        ? merchantById.get(user.merchantId)
        : undefined;

      return toUserListItemDto(user, {
        balances: wallet ? toBalancesDto(wallet) : null,
        insurancePayInMin:
          isTrader || isLead
            ? this.traderSettings.insurancePayInMinOf(
                settingsByUser.get(user.id),
              )
            : null,
        rates: rates ? (rates.bySubject.get(user.id) ?? rates.base) : null,
        leads: isTrader ? (leads.get(user.id) ?? []) : null,
        subordinates: isLead ? (subordinates.get(user.id) ?? []) : null,
        merchant: merchant ? { id: merchant.id, name: merchant.name } : null,
      });
    });
  }

  private async assertMayEdit(
    id: string,
    admin: AuthenticatedUser,
  ): Promise<void> {
    if (admin.id === id) {
      throw new ForbiddenException('Cannot edit your own account');
    }

    const target = await this.directory.findById(id);

    if (!target) throw new NotFoundException('User not found');

    if (!canIssueRole(admin.role, target.role)) {
      throw new ForbiddenException(`Cannot edit a ${target.role}`);
    }
  }

  @Get()
  @ApiOperation({
    summary:
      'Lists users with role and status, and the details that apply to each role',
  })
  @ApiPagedResponse(UserListItemDto)
  async list(
    @Query() query: ListUsersQueryDto,
  ): Promise<Page<UserListItemDto>> {
    const page = await this.directory.list(query);

    return new Page(await this.withDetails(page.items), page.meta);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Reads one user, in the same shape as a list row, whatever its status',
  })
  @ApiEnvelopeResponse(UserListItemDto)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserListItemDto> {
    const target = await this.directory.findById(id);

    if (!target) throw new NotFoundException('User not found');

    const [row] = await this.withDetails([target]);

    return row;
  }

  @Post(':id/leads')
  @WriteAccess()
  @ApiOperation({ summary: 'Puts a trader under a lead trader' })
  @ApiEnvelopeResponse(TeamMemberDto, {
    status: HttpStatus.CREATED,
    isArray: true,
  })
  async addLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddLeadDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TeamMemberDto[]> {
    await this.assertMayEdit(id, admin);
    await this.team.addLead(id, dto, admin.id);

    return (await this.team.leadsOf([id])).get(id) ?? [];
  }

  @Delete(':id/leads/:leadUserId')
  @WriteAccess()
  @ApiOperation({ summary: 'Takes a trader out from under a lead trader' })
  @ApiEnvelopeResponse(TeamMemberDto, { isArray: true })
  async removeLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('leadUserId', ParseUUIDPipe) leadUserId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TeamMemberDto[]> {
    await this.assertMayEdit(id, admin);
    await this.team.removeLead(id, leadUserId, admin.id);

    return (await this.team.leadsOf([id])).get(id) ?? [];
  }

  @Post(':id/sessions/revoke')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({ summary: 'Signs the user out of every session' })
  @ApiEnvelopeResponse()
  async revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<null> {
    await this.assertMayEdit(id, admin);
    await this.sessions.revokeAllSessionsAudited(id, admin.id);

    return null;
  }

  @Post(':id/password/reset')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Superadmin)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Replaces the password with a generated one, shown once, and signs the user out everywhere',
  })
  @ApiEnvelopeResponse(GeneratedPasswordDto)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<GeneratedPasswordDto> {
    await this.assertMayEdit(id, admin);

    return {
      password: await this.passwords.issueGeneratedPassword(id, admin.id),
    };
  }

  @Post(':id/login-link')
  @Roles(Role.Superadmin)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Issues a one-time link that opens an ordinary session of the user, shown once',
  })
  @ApiEnvelopeResponse(LoginLinkDto, { status: HttpStatus.CREATED })
  async issueLoginLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<LoginLinkDto> {
    if (admin.id === id) {
      throw new ForbiddenException('Cannot issue a login link for yourself');
    }

    const target = await this.directory.findById(id);

    if (!target) throw new NotFoundException('User not found');

    if (LOGIN_LINK_PROTECTED_ROLES.includes(target.role)) {
      throw new ForbiddenException(
        `Cannot issue a login link for a ${target.role}`,
      );
    }

    if (!AUTHENTICATABLE_STATUSES.includes(target.status)) {
      throw new ConflictException(
        `Cannot issue a login link for a ${target.status} account`,
      );
    }

    return this.loginLinks.issue(id, admin.id);
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({ summary: 'Updates a user account' })
  @ApiEnvelopeResponse(UserDto)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<UserDto> {
    const { resetTwoFactor, ...changes } = dto;

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    if (
      admin.role !== Role.Superadmin &&
      (dto.password !== undefined || resetTwoFactor !== undefined)
    ) {
      throw new ForbiddenException(
        'Only a superadmin may set a password or reset the second factor',
      );
    }

    if (admin.id === id) {
      throw new ForbiddenException('Cannot edit your own account');
    }

    const target = await this.directory.findById(id);

    if (!target) throw new NotFoundException('User not found');

    if (!canIssueRole(admin.role, target.role)) {
      throw new ForbiddenException(`Cannot edit a ${target.role}`);
    }

    if (changes.role !== undefined && !canIssueRole(admin.role, changes.role)) {
      throw new ForbiddenException(`Cannot grant the ${changes.role} role`);
    }

    let edited = target;

    if (changes.password !== undefined) {
      edited = await this.passwords.setPassword(id, changes, admin.id);
    } else if (Object.keys(changes).length) {
      edited = await this.administration.update(id, changes);
    }

    if (resetTwoFactor) {
      edited = await this.enrolment.resetTwoFactor(id);
    }

    const leftSuperadminAuthority =
      target.role === Role.Superadmin &&
      (edited.role !== Role.Superadmin || edited.status !== UserStatus.Active);

    if (leftSuperadminAuthority) {
      await this.sessions.revokeImpersonationSessions(id);
      await this.loginLinks.invalidateIssuedBy(id);
    }

    const becameLinkProtected =
      !LOGIN_LINK_PROTECTED_ROLES.includes(target.role) &&
      LOGIN_LINK_PROTECTED_ROLES.includes(edited.role);

    if (becameLinkProtected) {
      await this.sessions.revokeImpersonatedSessions(id);
    }

    return toUserDto(edited);
  }
}
