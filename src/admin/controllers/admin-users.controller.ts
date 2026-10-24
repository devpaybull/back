import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
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
import { AddLeadDto } from '../dto/add-lead.dto';
import { toBalancesDto } from '../dto/balances.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
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
    const effectiveRates = (
      scope: RateScope,
      userIds: string[],
    ): Promise<EffectiveGeneralRates | null> =>
      userIds.length
        ? this.rates.getEffectiveGeneralRates(
            scope,
            userIds.map((userId) => ({
              userId,
              individualEnabled:
                settingsByUser.get(userId)?.individualRatesEnabled ?? false,
            })),
          )
        : Promise.resolve(null);
    const [traderRates, leadRates] = await Promise.all([
      effectiveRates(RateScope.Trader, traderIds),
      effectiveRates(RateScope.Lead, leadIds),
    ]);

    return users.map((user) => {
      const isTrader = user.role === Role.Trader;
      const isLead = user.role === Role.LeadTrader;
      const rates = isTrader ? traderRates : isLead ? leadRates : null;
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
    await this.team.addLead(id, dto.leadUserId, admin.id);

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

    let edited = Object.keys(changes).length
      ? await this.administration.update(id, changes)
      : target;

    if (changes.password !== undefined) {
      await this.sessions.revokeAllSessions(id);
    }

    if (resetTwoFactor) {
      edited = await this.enrolment.resetTwoFactor(id);
    }

    return toUserDto(edited);
  }
}
