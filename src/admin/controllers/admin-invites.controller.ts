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
import { CreateInviteDto } from '../dto/create-invite.dto';
import { InviteDto, toInviteDto } from '../dto/invite.dto';
import { ListInvitesQueryDto } from '../dto/list-invites-query.dto';
import { canIssueRole } from '../utils/can-issue-role';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/invites')
export class AdminInvitesController {
  constructor(private readonly invites: InvitesService) {}

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

    return toInviteDto(
      await this.invites.create({
        identifier,
        role: dto.role,
        createdByUserId: admin.id,
        expiresAt: dto.expiresAt,
      }),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Lists issued invite codes' })
  @ApiPagedResponse(InviteDto)
  async list(@Query() query: ListInvitesQueryDto): Promise<Page<InviteDto>> {
    return (await this.invites.list(query)).map(toInviteDto);
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

    return toInviteDto(await this.invites.revoke(id, admin.id));
  }
}
