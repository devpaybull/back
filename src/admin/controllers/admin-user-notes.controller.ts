import {
  Body,
  Controller,
  Delete,
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
import { UserNotesService } from '../../user-notes/user-notes.service';
import { User } from '../../users/entities/user.entity';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserNoteDto, toUserNoteDto } from '../dto/user-note.dto';
import { WriteUserNoteDto } from '../dto/write-user-note.dto';
import { canIssueRole } from '../utils/can-issue-role';

@ApiTags('Admin · User notes')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/users/:id/note')
export class AdminUserNotesController {
  constructor(
    private readonly notes: UserNotesService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Reads the admin note on an account, or null' })
  @ApiEnvelopeResponse(UserNoteDto)
  async read(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserNoteDto | null> {
    await this.requireUser(id);

    const note = await this.notes.findByUserId(id);

    return note ? toUserNoteDto(note) : null;
  }

  @Put()
  @WriteAccess()
  @ApiOperation({ summary: 'Creates or replaces the admin note on an account' })
  @ApiEnvelopeResponse(UserNoteDto)
  async write(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WriteUserNoteDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<UserNoteDto> {
    const target = await this.requireUser(id);

    this.assertMayAct(admin, target);

    return toUserNoteDto(await this.notes.write(id, dto.text, admin.id));
  }

  @Delete()
  @WriteAccess()
  @ApiOperation({ summary: 'Deletes the admin note on an account' })
  @ApiEnvelopeResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<void> {
    const target = await this.requireUser(id);

    this.assertMayAct(admin, target);

    await this.notes.delete(id);
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  private assertMayAct(admin: AuthenticatedUser, target: User): void {
    if (!canIssueRole(admin.role, target.role)) {
      throw new ForbiddenException(`Cannot edit a ${target.role}`);
    }
  }
}
