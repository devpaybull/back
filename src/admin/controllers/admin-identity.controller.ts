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
import { LoginFootprintService } from '../../auth/services/login-footprint.service';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import {
  LoginFootprintDto,
  toLoginFootprintDto,
} from '../dto/login-footprint.dto';

@ApiTags('Admin · Identity')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/users')
export class AdminIdentityController {
  constructor(
    private readonly footprints: LoginFootprintService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get(':id/footprints')
  @ApiOperation({
    summary: 'Lists where an account has logged in from',
    description:
      'One row per distinct ip, fingerprint and user agent, newest login first by default. seenOnAccounts counts the distinct accounts that share the combination.',
  })
  @ApiPagedResponse(LoginFootprintDto)
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<LoginFootprintDto>> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    return (await this.footprints.list(id, query)).map(toLoginFootprintDto);
  }
}
