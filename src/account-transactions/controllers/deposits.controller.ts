import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { renderQrCodeDataUrl } from '../../common/utils/render-qr-code-data-url';
import { toCrypto } from '../../common/utils/to-crypto';
import { UserStatus } from '../../users/types/user-status.enum';
import { CreateDepositRequestDto } from '../dto/create-deposit-request.dto';
import { DepositAddressDto } from '../dto/deposit-address.dto';
import {
  DepositRequestDto,
  toDepositRequestDto,
} from '../dto/deposit-request.dto';
import { DepositsService } from '../services/deposits.service';
import { AccountTransaction } from '../entities/account-transaction.entity';

@ApiTags('Finances')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader, Role.LeadTrader)
@Controller('users/me')
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Get('deposit-address')
  @ApiOperation({
    summary:
      'The trader’s permanent USDT TRC-20 deposit address, issued on first use',
  })
  @ApiEnvelopeResponse(DepositAddressDto)
  async depositAddress(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DepositAddressDto> {
    if (user.status === UserStatus.Suspended) {
      const existing = await this.deposits.existingDepositAddressOf(user.id);

      if (!existing) {
        throw new ForbiddenException(
          'A suspended account cannot be issued an address',
        );
      }

      return this.toAddressDto(existing.address);
    }

    return this.toAddressDto(
      (await this.deposits.depositAddressOf(user.id)).address,
    );
  }

  @Post('deposits')
  @WriteAccess()
  @ApiOperation({ summary: 'Opens a deposit request (a hint with a window)' })
  @ApiEnvelopeResponse(DepositRequestDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateDepositRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DepositRequestDto> {
    return this.toDto(
      await this.deposits.createRequest(user.id, toCrypto(dto.amount)),
    );
  }

  @Get('deposits/:id')
  @ApiOperation({ summary: 'One of the trader’s own deposits' })
  @ApiEnvelopeResponse(DepositRequestDto)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DepositRequestDto> {
    return this.toDto(await this.deposits.findOwn(id, user.id));
  }

  @Post('deposits/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Cancels a pending request; a transfer that still arrives is credited',
  })
  @ApiEnvelopeResponse(DepositRequestDto)
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DepositRequestDto> {
    return this.toDto(await this.deposits.cancelOwn(id, user.id));
  }

  private async toAddressDto(address: string): Promise<DepositAddressDto> {
    return {
      address,
      network: 'TRC20',
      qrCode: await renderQrCodeDataUrl(address),
    };
  }

  private async toDto(row: AccountTransaction): Promise<DepositRequestDto> {
    return toDepositRequestDto(row, await renderQrCodeDataUrl(row.address!));
  }
}
