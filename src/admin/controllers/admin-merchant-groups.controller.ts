import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { INT4_MAX } from '../../common/utils/int4-max';
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
import { MerchantGroupsService } from '../../merchants/services/merchant-groups.service';
import { AddGroupMerchantsDto } from '../dto/add-group-merchants.dto';
import { CreateMerchantGroupDto } from '../dto/create-merchant-group.dto';
import { ListMerchantGroupsQueryDto } from '../dto/list-merchant-groups-query.dto';
import {
  MerchantGroupDto,
  toMerchantGroupDto,
} from '../dto/merchant-group.dto';
import {
  MerchantGroupListItemDto,
  toMerchantGroupListItemDto,
} from '../dto/merchant-group-list-item.dto';
import { UpdateMerchantGroupDto } from '../dto/update-merchant-group.dto';

const assertGroupIdInRange = (id: number): void => {
  if (id < 1 || id > INT4_MAX) {
    throw new BadRequestException('Merchant group id is out of range');
  }
};

@ApiTags('Admin · Merchant groups')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/merchant-groups')
export class AdminMerchantGroupsController {
  constructor(private readonly groups: MerchantGroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Lists merchant groups with their merchant count' })
  @ApiPagedResponse(MerchantGroupListItemDto)
  async list(
    @Query() query: ListMerchantGroupsQueryDto,
  ): Promise<Page<MerchantGroupListItemDto>> {
    return (await this.groups.list(query)).map(toMerchantGroupListItemDto);
  }

  @Post()
  @WriteAccess()
  @ApiOperation({
    summary:
      'Creates a group and moves the given merchants, none of them in another group, into it',
  })
  @ApiEnvelopeResponse(MerchantGroupDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateMerchantGroupDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantGroupDto> {
    return toMerchantGroupDto(
      await this.groups.create(dto.name, dto.merchantIds, admin.id),
    );
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Renames a group and writes status and «Искл. залив» into every merchant of it',
  })
  @ApiEnvelopeResponse(MerchantGroupDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMerchantGroupDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantGroupDto> {
    assertGroupIdInRange(id);

    if (
      dto.name === undefined &&
      dto.active === undefined &&
      dto.exclusiveTopUp === undefined
    ) {
      throw new BadRequestException('No changes were given');
    }

    return toMerchantGroupDto(await this.groups.update(id, dto, admin.id));
  }

  @Post(':id/merchants')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: 'Adds merchants without a group to the group',
  })
  @ApiEnvelopeResponse(MerchantGroupDto)
  async addMerchants(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddGroupMerchantsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantGroupDto> {
    assertGroupIdInRange(id);

    return toMerchantGroupDto(
      await this.groups.addMerchants(id, dto.merchantIds, admin.id),
    );
  }

  @Delete(':id/merchants/:merchantId')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Takes a merchant out of the group; a group left empty is deleted and the answer is null',
  })
  @ApiEnvelopeResponse(MerchantGroupDto)
  async removeMerchant(
    @Param('id', ParseIntPipe) id: number,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantGroupDto | null> {
    assertGroupIdInRange(id);

    const view = await this.groups.removeMerchant(id, merchantId, admin.id);

    return view ? toMerchantGroupDto(view) : null;
  }
}
