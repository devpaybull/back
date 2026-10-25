import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankDetailsService } from '../../bank-details/bank-details.service';
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
import { DevicesService } from '../../devices/devices.service';
import { DeviceDto, toDeviceDto } from '../dto/device.dto';
import { ListDevicesQueryDto } from '../dto/list-devices-query.dto';

@ApiTags('Admin · Devices')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/devices')
export class AdminDevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly bankDetails: BankDetailsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists the devices of every account' })
  @ApiPagedResponse(DeviceDto)
  async list(@Query() query: ListDevicesQueryDto): Promise<Page<DeviceDto>> {
    return (await this.devices.list(query)).map(toDeviceDto);
  }

  @Delete(':id')
  @WriteAccess()
  @ApiOperation({
    summary: 'Deletes any account’s device',
    description:
      'A soft delete: the row stays and the device stops being listed. Requisites bound to it are unbound first and keep working.',
  })
  @ApiEnvelopeResponse()
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<void> {
    if (!(await this.devices.findById(id))) {
      throw new NotFoundException('Device not found');
    }

    await this.bankDetails.deleteDevice(id, admin.id);
  }
}
