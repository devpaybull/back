import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { loginOf } from '../../common/utils/login-of';
import { RateService } from '../../transactions/services/rate.service';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { User } from '../../users/entities/user.entity';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserTeamService } from '../../users/services/user-team.service';
import {
  LeadAssignmentDto,
  toLeadAssignmentDto,
} from '../dto/lead-assignment.dto';
import { RateSetDto, toRateSetDto } from '../dto/rate-set.dto';
import { ReferralDto, ReferralRateSummaryDto } from '../dto/referral.dto';
import { ReplaceLeadsDto } from '../dto/replace-leads.dto';
import { canIssueRole } from '../utils/can-issue-role';

@ApiTags('Admin · Leads')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/users/:id')
export class AdminLeadsController {
  constructor(
    private readonly directory: UserDirectoryService,
    private readonly team: UserTeamService,
    private readonly rates: RateService,
  ) {}

  @Get('leads')
  @ApiOperation({
    summary: 'Reads a trader’s lead assignments: one row per lead × currency',
  })
  @ApiEnvelopeResponse(LeadAssignmentDto, { isArray: true })
  async readLeads(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadAssignmentDto[]> {
    await this.requireUser(id);

    return (await this.team.assignmentsOf(id)).map(toLeadAssignmentDto);
  }

  @Put('leads')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Replaces a trader’s whole set of lead assignments (lead, currency, general pay-in and pay-out rate)',
  })
  @ApiEnvelopeResponse(LeadAssignmentDto, { isArray: true })
  async replaceLeads(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceLeadsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<LeadAssignmentDto[]> {
    await this.assertMayEdit(id, admin);

    return (await this.team.replaceLeads(id, dto.leads, admin.id)).map(
      toLeadAssignmentDto,
    );
  }

  @Get('leads/:leadUserId/rates')
  @ApiOperation({
    summary: 'Reads the detailed rate a lead takes from a trader, per method',
  })
  @ApiEnvelopeResponse(RateSetDto)
  async readLeadRates(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('leadUserId', ParseUUIDPipe) leadUserId: string,
  ): Promise<RateSetDto> {
    await this.requireUser(id);
    const links = await this.requirePair(id, leadUserId);

    return toRateSetDto(
      await this.rates.getLeadSet(links.map((link) => link.id)),
    );
  }

  @Put('leads/:leadUserId/rates')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Replaces the detailed rate a lead takes from a trader: per method a general rate and amount bands or bank rows',
  })
  @ApiEnvelopeResponse(RateSetDto)
  async replaceLeadRates(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('leadUserId', ParseUUIDPipe) leadUserId: string,
    @Body() dto: RateSetDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<RateSetDto> {
    await this.assertMayEdit(id, admin);
    const links = await this.requirePair(id, leadUserId);

    const entries = dto.methods.map((method) => ({
      method: method.method,
      general: method.general ?? null,
      bands: method.bands ?? [],
      banks: method.banks ?? [],
    }));

    return toRateSetDto(
      await this.rates.replaceLeadSet(links, entries, {
        actorUserId: admin.id,
        traderUserId: id,
        leadUserId,
      }),
    );
  }

  @Get('referrals')
  @ApiOperation({
    summary:
      'The referral tab: a lead trader’s traders, or a trader’s leads, with the lead’s rate summary per currency',
  })
  @ApiEnvelopeResponse(ReferralDto, { isArray: true })
  async referrals(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReferralDto[]> {
    const user = await this.requireUser(id);

    if (user.role === Role.LeadTrader) {
      return this.summarised(
        await this.team.assignmentsLedBy(id),
        (link) => link.trader,
      );
    }

    if (user.role === Role.Trader) {
      return this.summarised(
        await this.team.assignmentsOf(id),
        (link) => link.lead,
      );
    }

    return [];
  }

  private async summarised(
    links: TraderLead[],
    otherSideOf: (link: TraderLead) => User,
  ): Promise<ReferralDto[]> {
    const detail = await this.rates.getLeadSet(links.map((link) => link.id));
    const byAccount = new Map<string, ReferralDto>();

    for (const link of links) {
      const account = otherSideOf(link);
      const referral = byAccount.get(account.id) ?? {
        id: account.id,
        login: loginOf(account),
        rates: [],
      };
      const rows = [
        link,
        ...detail.filter((row) => row.traderLeadId === link.id),
      ];
      const payIn = rows.map((row) => row.payInPercent);
      const payOut = rows.map((row) => row.payOutPercent);
      const summary: ReferralRateSummaryDto = {
        currencyId: link.currencyId,
        currency: link.currency.isocode,
        payInMin: Math.min(...payIn),
        payInMax: Math.max(...payIn),
        payOutMin: Math.min(...payOut),
        payOutMax: Math.max(...payOut),
      };

      referral.rates.push(summary);
      byAccount.set(account.id, referral);
    }

    return [...byAccount.values()];
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  private async requirePair(
    traderUserId: string,
    leadUserId: string,
  ): Promise<TraderLead[]> {
    const links = await this.team.findPair(traderUserId, leadUserId);

    if (!links.length) {
      throw new NotFoundException('This lead does not lead the trader');
    }

    return links;
  }

  private async assertMayEdit(
    id: string,
    admin: AuthenticatedUser,
  ): Promise<void> {
    if (admin.id === id) {
      throw new ForbiddenException('Cannot edit your own account');
    }

    const target = await this.requireUser(id);

    if (!canIssueRole(admin.role, target.role)) {
      throw new ForbiddenException(`Cannot edit a ${target.role}`);
    }
  }
}
