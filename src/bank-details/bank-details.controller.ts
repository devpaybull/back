import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { BankDetailsService } from './bank-details.service';
import { CreateBankDetailsDto } from './dto/create-bank-details.dto';
import { ListBankDetailsQueryDto } from './dto/list-bank-details-query.dto';
import {
  OwnBankDetailsDto,
  toOwnBankDetailsDto,
} from './dto/own-bank-details.dto';
import { UpdateBankDetailsDto } from './dto/update-bank-details.dto';

@ApiTags('Bank details')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('bank-details')
export class BankDetailsController {
  constructor(private readonly bankDetails: BankDetailsService) {}

  @Post()
  @WriteAccess()
  @ApiOperation({ summary: 'Attaches bank details to the signed-in account' })
  @ApiEnvelopeResponse(OwnBankDetailsDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateBankDetailsDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnBankDetailsDto> {
    return toOwnBankDetailsDto(
      await this.bankDetails.create(
        { ...dto, userId: trader.id },
        trader.impersonatedBy ?? null,
      ),
      this.bankDetails.counterpartyMinAmount,
    );
  }

  @Get()
  @ApiOperation({ summary: "Lists the signed-in account's own bank details" })
  @ApiPagedResponse(OwnBankDetailsDto)
  async list(
    @Query() query: ListBankDetailsQueryDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<Page<OwnBankDetailsDto>> {
    const { counterpartyMinAmount } = this.bankDetails;

    return (await this.bankDetails.list({ ...query, userId: trader.id })).map(
      (row) => toOwnBankDetailsDto(row, counterpartyMinAmount),
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Reads one of the signed-in account’s bank details',
  })
  @ApiEnvelopeResponse(OwnBankDetailsDto)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnBankDetailsDto> {
    const found = await this.bankDetails.findOwn(id, trader.id);

    if (!found) throw new NotFoundException('Bank details not found');

    return toOwnBankDetailsDto(found, this.bankDetails.counterpartyMinAmount);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: 'Switches bank details the signed-in account owns on',
    description:
      'A 409 while an administrator has banned them — the owner cannot lift a ban.',
  })
  @ApiEnvelopeResponse(OwnBankDetailsDto)
  async enable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnBankDetailsDto> {
    return toOwnBankDetailsDto(
      await this.bankDetails.updateOwn(id, trader.id, { active: true }),
      this.bankDetails.counterpartyMinAmount,
    );
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: 'Switches bank details the signed-in account owns off',
  })
  @ApiEnvelopeResponse(OwnBankDetailsDto)
  async disable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnBankDetailsDto> {
    return toOwnBankDetailsDto(
      await this.bankDetails.updateOwn(id, trader.id, { active: false }),
      this.bankDetails.counterpartyMinAmount,
    );
  }

  @Delete(':id')
  @WriteAccess()
  @ApiOperation({
    summary: 'Deletes bank details the signed-in account owns',
    description:
      'A soft delete: the row stays and stops being listed, so what an order pointed at is not erased.',
  })
  @ApiEnvelopeResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<void> {
    await this.bankDetails.deleteOwn(
      id,
      trader.id,
      trader.impersonatedBy ?? null,
    );
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({ summary: 'Updates bank details the signed-in account owns' })
  @ApiEnvelopeResponse(OwnBankDetailsDto)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankDetailsDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnBankDetailsDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return toOwnBankDetailsDto(
      await this.bankDetails.updateOwn(id, trader.id, dto),
      this.bankDetails.counterpartyMinAmount,
    );
  }
}
