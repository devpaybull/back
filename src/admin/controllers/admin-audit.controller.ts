import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../audit/services/audit.service';
import { ACTIVITY_ACTIONS } from '../../audit/types/activity-action.enum';
import { AuditSortField } from '../../audit/types/audit-sort-field.enum';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { loginOf } from '../../common/utils/login-of';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import {
  ActivityEntryDto,
  toActivityEntryDto,
} from '../dto/activity-entry.dto';
import { AuditLogDto, toAuditLogDto } from '../dto/audit-log.dto';
import { ListAllAuditQueryDto } from '../dto/list-all-audit-query.dto';
import { ListAuditQueryDto } from '../dto/list-audit-query.dto';

@ApiTags('Admin · Audit')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin')
export class AdminAuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get('audit')
  @ApiOperation({
    summary: 'Lists the whole audit trail, Postgres and the archive together',
  })
  @ApiPagedResponse(AuditLogDto)
  async listAll(
    @Query() query: ListAllAuditQueryDto,
  ): Promise<Page<AuditLogDto>> {
    return (
      await this.audit.list({
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
        targetUserId: query.targetUserId,
        actorUserId: query.actorUserId,
        impersonatorUserId: query.impersonatorUserId,
        action: query.action,
        source: query.source,
        statusCode: query.statusCode,
      })
    ).map(toAuditLogDto);
  }

  @Get('users/:id/audit')
  @ApiOperation({ summary: 'Lists the audit trail targeting one account' })
  @ApiPagedResponse(AuditLogDto)
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListAuditQueryDto,
  ): Promise<Page<AuditLogDto>> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    return (
      await this.audit.list({
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
        targetUserId: id,
      })
    ).map(toAuditLogDto);
  }

  @Get('users/:id/activity')
  @ApiOperation({
    summary: 'Lists the activity feed of one account',
    description:
      'The events the system records about an account — trading and auto-buyback switched, bank details and devices added or deleted — each with who did it (null: the system). Not the raw request audit; that is GET /admin/users/:id/audit.',
  })
  @ApiPagedResponse(ActivityEntryDto)
  async activity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<ActivityEntryDto>> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    const records = await this.audit.list({
      page: query.page,
      limit: query.limit,
      sortBy: AuditSortField.CreatedAt,
      sortOrder: query.sortOrder,
      targetUserId: id,
      actions: ACTIVITY_ACTIONS,
    });
    const actorIds = [
      ...new Set(
        records.items.flatMap((record) =>
          [record.actorUserId, record.impersonatorUserId].filter(
            (userId): userId is string => userId !== null,
          ),
        ),
      ),
    ];
    const actors = await this.directory.findByIds(actorIds);
    const loginsById = new Map(
      actors.map((actor) => [actor.id, loginOf(actor)]),
    );

    return records.map((record) => toActivityEntryDto(record, loginsById));
  }
}
