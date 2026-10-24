import {
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { MerchantsService } from '../../merchants/merchants.service';
import { CreateMerchantDto } from '../dto/create-merchant.dto';
import {
  MerchantApiKeyDto,
  toMerchantApiKeyDto,
} from '../dto/merchant-api-key.dto';
import { MerchantDto, toMerchantDto } from '../dto/merchant.dto';
import { ListMerchantsQueryDto } from '../dto/list-merchants-query.dto';

@ApiTags('Admin · Merchants')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/merchants')
export class AdminMerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @ApiOperation({ summary: 'Lists merchants' })
  @ApiPagedResponse(MerchantDto)
  async list(
    @Query() query: ListMerchantsQueryDto,
  ): Promise<Page<MerchantDto>> {
    return (await this.merchants.list(query)).map(toMerchantDto);
  }

  @Post()
  @WriteAccess()
  @ApiOperation({ summary: 'Creates a merchant' })
  @ApiEnvelopeResponse(MerchantDto, { status: HttpStatus.CREATED })
  async create(@Body() dto: CreateMerchantDto): Promise<MerchantDto> {
    return toMerchantDto(await this.merchants.create(dto.name));
  }

  @Post(':id/keys')
  @WriteAccess()
  @ApiOperation({
    summary: 'Issues an API key for a merchant (key and secret shown once)',
  })
  @ApiEnvelopeResponse(MerchantApiKeyDto, { status: HttpStatus.CREATED })
  async createKey(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantApiKeyDto> {
    const merchant = await this.merchants.findById(id);

    if (!merchant) throw new NotFoundException('Merchant not found');

    return toMerchantApiKeyDto(await this.merchants.createKey(id));
  }
}
