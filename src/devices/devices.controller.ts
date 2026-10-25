import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankDetailsService } from '../bank-details/bank-details.service';
import { ApiEnvelopeResponse } from '../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { WriteAccess } from '../common/decorators/write-access.decorator';
import { Role } from '../common/enums/role.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import { WriteAccessGuard } from '../common/guards/write-access.guard';
import { Page } from '../common/types/page';
import { AuthenticatedUser } from '../common/types/token';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { ListDevicesQueryDto } from './dto/list-devices-query.dto';
import { OwnDeviceDto, toOwnDeviceDto } from './dto/own-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

@ApiTags('Devices')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly bankDetails: BankDetailsService,
  ) {}

  @Post()
  @WriteAccess()
  @ApiOperation({
    summary: 'Registers a device against the signed-in account',
    description:
      'The owner supplies a name and nothing else. The phone app reports the model, type, phone number, status and last activity later, against the key this returns.',
  })
  @ApiEnvelopeResponse(OwnDeviceDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnDeviceDto> {
    return toOwnDeviceDto(
      await this.devices.create(
        { ...dto, userId: trader.id },
        trader.impersonatedBy ?? null,
      ),
    );
  }

  @Get()
  @ApiOperation({ summary: "Lists the signed-in account's own devices" })
  @ApiPagedResponse(OwnDeviceDto)
  async list(
    @Query() query: ListDevicesQueryDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<Page<OwnDeviceDto>> {
    return (await this.devices.list({ ...query, userId: trader.id })).map(
      toOwnDeviceDto,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one of the signed-in account’s devices' })
  @ApiEnvelopeResponse(OwnDeviceDto)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnDeviceDto> {
    const found = await this.devices.findOwn(id, trader.id);

    if (!found) throw new NotFoundException('Device not found');

    return toOwnDeviceDto(found);
  }

  @Delete(':id')
  @WriteAccess()
  @ApiOperation({
    summary: 'Deletes a device the signed-in account owns',
    description:
      'A soft delete: the row stays and the device stops being listed. Requisites bound to it are unbound first and keep working.',
  })
  @ApiEnvelopeResponse()
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<void> {
    await this.bankDetails.deleteOwnDevice(
      id,
      trader.id,
      trader.impersonatedBy ?? null,
    );
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({
    summary: 'Renames a device the signed-in account owns',
    description:
      'The name is the only field the owner may change; everything else belongs to the phone app.',
  })
  @ApiEnvelopeResponse(OwnDeviceDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnDeviceDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return toOwnDeviceDto(await this.devices.updateOwn(id, trader.id, dto));
  }
}
