import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
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
import { INT4_MAX } from '../../common/utils/int4-max';
import { maskIp } from '../../common/utils/mask-ip';
import { MerchantIpAddress } from '../../merchants/entities/merchant-ip-address.entity';
import { MerchantIpAddressesService } from '../../merchants/services/merchant-ip-addresses.service';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { AddMerchantIpAddressDto } from '../dto/add-merchant-ip-address.dto';
import {
  MerchantApiKeyDto,
  toMerchantApiKeyDto,
} from '../dto/merchant-api-key.dto';
import {
  MerchantApiKeySummaryDto,
  toMerchantApiKeySummaryDto,
} from '../dto/merchant-api-key-summary.dto';
import { MerchantIpAddressDto } from '../dto/merchant-ip-address.dto';

const requireStoredId = (id: number, what: string): void => {
  if (id < 1 || id > INT4_MAX) throw new NotFoundException(`${what} not found`);
};

const toIpAddressDto = (
  row: MerchantIpAddress,
  role: AuthenticatedUser['role'],
): MerchantIpAddressDto => {
  const masked = role !== Role.Superadmin;

  return {
    id: row.id,
    ip: masked ? maskIp(row.ip) : row.ip,
    masked,
    createdAt: row.createdAt,
  };
};

@ApiTags('Admin · Merchant integrations')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/merchants/:id')
export class AdminMerchantIntegrationsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly addresses: MerchantIpAddressesService,
  ) {}

  @Get('keys')
  @Roles(Role.Superadmin)
  @ApiOperation({
    summary: 'Lists the merchant’s API keys, without their secrets',
  })
  @ApiEnvelopeResponse(MerchantApiKeySummaryDto, { isArray: true })
  async keys(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantApiKeySummaryDto[]> {
    await this.requireMerchant(id);

    return (await this.merchants.listKeys(id)).map(toMerchantApiKeySummaryDto);
  }

  @Post('keys')
  @Roles(Role.Superadmin)
  @WriteAccess()
  @ApiOperation({
    summary: 'Issues an API key for a merchant (key and secret shown once)',
  })
  @ApiEnvelopeResponse(MerchantApiKeyDto, { status: HttpStatus.CREATED })
  async createKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantApiKeyDto> {
    return toMerchantApiKeyDto(await this.merchants.createKey(id, admin.id));
  }

  @Post('keys/:keyId/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Superadmin)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Revokes a merchant API key; revoking a revoked key changes nothing',
  })
  @ApiEnvelopeResponse(MerchantApiKeySummaryDto)
  async revokeKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('keyId', ParseIntPipe) keyId: number,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantApiKeySummaryDto> {
    requireStoredId(keyId, 'API key');

    return toMerchantApiKeySummaryDto(
      await this.merchants.revokeKey(id, keyId, admin.id),
    );
  }

  @Get('ip-addresses')
  @ApiOperation({
    summary:
      'Lists the merchant’s IP whitelist; an admin gets masked addresses, a superadmin the full ones',
  })
  @ApiEnvelopeResponse(MerchantIpAddressDto, { isArray: true })
  async ipAddresses(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantIpAddressDto[]> {
    await this.requireMerchant(id);

    return (await this.addresses.list(id)).map((row) =>
      toIpAddressDto(row, admin.role),
    );
  }

  @Post('ip-addresses')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Adds one IPv4 or IPv6 address to the whitelist; a duplicate is a 409, more than 50 a 400',
  })
  @ApiEnvelopeResponse(MerchantIpAddressDto, { status: HttpStatus.CREATED })
  async addIpAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMerchantIpAddressDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantIpAddressDto> {
    return toIpAddressDto(
      await this.addresses.add(id, dto.ip, admin.id),
      admin.role,
    );
  }

  @Delete('ip-addresses/:ipAddressId')
  @Roles(Role.Superadmin)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Removes an address from the whitelist; the last one cannot go while IP checking is on',
  })
  @ApiEnvelopeResponse()
  async removeIpAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ipAddressId', ParseIntPipe) ipAddressId: number,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<void> {
    requireStoredId(ipAddressId, 'IP address');
    await this.addresses.remove(id, ipAddressId, admin.id);
  }

  private async requireMerchant(id: string): Promise<void> {
    if (!(await this.merchants.findById(id))) {
      throw new NotFoundException('Merchant not found');
    }
  }
}
