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
  ParseIntPipe,
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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Page } from '../common/types/page';
import { AuthenticatedUser } from '../common/types/token';
import { BankDetailsTurnoverService } from '../transactions/services/bank-details-turnover.service';
import { BankDetailsService } from './bank-details.service';
import {
  BankDetailTagDto,
  toBankDetailTagDto,
} from './dto/bank-detail-tag.dto';
import { BankDetailsStatusCountsDto } from './dto/bank-details-status-counts.dto';
import { CreateBankDetailTagDto } from './dto/create-bank-detail-tag.dto';
import { CreateBankDetailsDto } from './dto/create-bank-details.dto';
import { ListBankDetailsQueryDto } from './dto/list-bank-details-query.dto';
import {
  OwnBankDetailsDto,
  toOwnBankDetailsDto,
} from './dto/own-bank-details.dto';
import {
  RequisiteHistoryEntryDto,
  toRequisiteHistoryEntryDto,
} from './dto/requisite-history-entry.dto';
import { RequisiteHistoryReadStateDto } from './dto/requisite-history-read-state.dto';
import { UpdateBankDetailsDto } from './dto/update-bank-details.dto';
import { BankDetails } from './entities/bank-details.entity';
import { withFiatLimits } from './utils/with-fiat-limits';

@ApiTags('Trader · Requisites')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader')
export class BankDetailsController {
  constructor(
    private readonly bankDetails: BankDetailsService,
    private readonly turnover: BankDetailsTurnoverService,
  ) {}

  @Post('requisites')
  @WriteAccess()
  @ApiOperation({ summary: 'Attaches bank details to the signed-in account' })
  @ApiEnvelopeResponse(OwnBankDetailsDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateBankDetailsDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<OwnBankDetailsDto> {
    return this.withExtrasOf(
      await this.bankDetails.create(
        { ...withFiatLimits(dto), userId: trader.id },
        trader.impersonatedBy ?? null,
      ),
    );
  }

  @Get('requisites')
  @ApiOperation({ summary: "Lists the signed-in account's own bank details" })
  @ApiPagedResponse(OwnBankDetailsDto)
  async list(
    @Query() query: ListBankDetailsQueryDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<Page<OwnBankDetailsDto>> {
    const page = await this.bankDetails.list({ ...query, userId: trader.id });

    return new Page(await this.withExtras(page.items), page.meta);
  }

  @Get('requisites/counts')
  @ApiOperation({
    summary: 'Counts the signed-in account’s bank details per status',
    description:
      'The tabs «Все / Активные / Выключеные»: the list filters except status apply.',
  })
  @ApiEnvelopeResponse(BankDetailsStatusCountsDto)
  counts(
    @Query() query: ListBankDetailsQueryDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<BankDetailsStatusCountsDto> {
    return this.bankDetails.countByStatus({
      ...query,
      status: undefined,
      userId: trader.id,
    });
  }

  @Get('requisites/history')
  @ApiOperation({
    summary: 'Lists what happened to the signed-in account’s bank details',
    description:
      'Created, updated, switched, banned and deleted — by the owner, an administrator or the system; newest first by default.',
  })
  @ApiPagedResponse(RequisiteHistoryEntryDto)
  async history(
    @Query() query: PaginationQueryDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<Page<RequisiteHistoryEntryDto>> {
    return (await this.bankDetails.history(trader.id, query)).map((entry) =>
      toRequisiteHistoryEntryDto(entry, trader.id),
    );
  }

  @Get('requisites/history/unread')
  @ApiOperation({ summary: 'Counts the unread rows of the history' })
  @ApiEnvelopeResponse(RequisiteHistoryReadStateDto)
  historyReadState(
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<RequisiteHistoryReadStateDto> {
    return this.bankDetails.historyReadState(trader.id);
  }

  @Post('requisites/history/read')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({ summary: 'Marks the whole history read, as of now' })
  @ApiEnvelopeResponse(RequisiteHistoryReadStateDto)
  markHistoryRead(
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<RequisiteHistoryReadStateDto> {
    return this.bankDetails.markHistoryRead(trader.id);
  }

  @Get('requisite-tags')
  @ApiOperation({ summary: 'Lists the signed-in account’s tags' })
  @ApiPagedResponse(BankDetailTagDto)
  async listTags(
    @Query() query: PaginationQueryDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<Page<BankDetailTagDto>> {
    return (await this.bankDetails.listTags(trader.id, query)).map(
      toBankDetailTagDto,
    );
  }

  @Post('requisite-tags')
  @WriteAccess()
  @ApiOperation({
    summary: 'Creates a tag of the signed-in account',
    description:
      'A name the account already has, in any letter case, is a 409.',
  })
  @ApiEnvelopeResponse(BankDetailTagDto, { status: HttpStatus.CREATED })
  async createTag(
    @Body() dto: CreateBankDetailTagDto,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<BankDetailTagDto> {
    return toBankDetailTagDto(
      await this.bankDetails.createTag(trader.id, dto.name),
    );
  }

  @Delete('requisite-tags/:tagId')
  @WriteAccess()
  @ApiOperation({
    summary: 'Deletes a tag of the signed-in account',
    description:
      'The tag comes off every requisite; another account’s tag is a 404.',
  })
  @ApiEnvelopeResponse()
  async deleteTag(
    @Param('tagId', ParseIntPipe) tagId: number,
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<void> {
    await this.bankDetails.deleteTag(trader.id, tagId);
  }

  @Get('requisites/:id')
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

    return this.withExtrasOf(found);
  }

  @Post('requisites/:id/enable')
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
    return this.withExtrasOf(
      await this.bankDetails.updateOwn(
        id,
        trader.id,
        { active: true },
        trader.impersonatedBy ?? null,
      ),
    );
  }

  @Post('requisites/:id/disable')
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
    return this.withExtrasOf(
      await this.bankDetails.updateOwn(
        id,
        trader.id,
        { active: false },
        trader.impersonatedBy ?? null,
      ),
    );
  }

  @Delete('requisites/:id')
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

  @Patch('requisites/:id')
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

    return this.withExtrasOf(
      await this.bankDetails.updateOwn(
        id,
        trader.id,
        withFiatLimits(dto),
        trader.impersonatedBy ?? null,
      ),
    );
  }

  private async withExtras(rows: BankDetails[]): Promise<OwnBankDetailsDto[]> {
    const ids = rows.map((row) => row.id);
    const now = new Date();
    const [turnover, usage, bound, tags] = await Promise.all([
      this.turnover.turnoverOfBankDetails(ids, now),
      this.turnover.usageOfBankDetails(ids, now),
      this.bankDetails.boundCounterpartiesOf(ids),
      this.bankDetails.tagsOf(ids),
    ]);
    const { counterpartyMinAmount } = this.bankDetails;

    return rows.map((row) =>
      toOwnBankDetailsDto(row, counterpartyMinAmount, {
        turnover: turnover.get(row.id),
        usage: usage.get(row.id),
        boundCounterparties: bound.get(row.id) ?? 0,
        tags: tags.get(row.id) ?? [],
      }),
    );
  }

  private async withExtrasOf(details: BankDetails): Promise<OwnBankDetailsDto> {
    const [dto] = await this.withExtras([details]);

    return dto;
  }
}
