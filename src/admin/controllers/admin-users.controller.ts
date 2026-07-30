import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { UserAdministrationService } from '../../users/services/user-administration.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserEnrolmentService } from '../../users/services/user-enrolment.service';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { toUserDto, UserDto } from '../dto/user.dto';
import { canIssueRole } from '../utils/can-issue-role';

@ApiTags('admin')
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
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists users with role and status' })
  @ApiPagedResponse(UserDto)
  async list(@Query() query: ListUsersQueryDto): Promise<Page<UserDto>> {
    return (await this.directory.list(query)).map(toUserDto);
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
