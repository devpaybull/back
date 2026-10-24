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
import { AuditService } from '../../audit/audit.service';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { AuditLogDto, toAuditLogDto } from '../dto/audit-log.dto';
import { ListAuditQueryDto } from '../dto/list-audit-query.dto';

@ApiTags('Admin · Audit')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/users/:id/audit')
export class AdminAuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get()
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
}
