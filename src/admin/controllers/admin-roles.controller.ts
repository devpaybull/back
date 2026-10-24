import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';

@ApiTags('Admin · Roles')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/roles')
export class AdminRolesController {
  @Get()
  @ApiOperation({ summary: 'Lists every role an account can hold' })
  @ApiResponse({
    status: HttpStatus.OK,
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'array',
          items: { type: 'string', enum: Object.values(Role) },
        },
      },
    },
  })
  list(): Role[] {
    return Object.values(Role);
  }
}
