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
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { BankDetailsSortField } from '../../bank-details/types/bank-details-sort-field';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page, toPage } from '../../common/types/page';
import { sortDirection } from '../../common/utils/sort-direction';
import { BankDetailsTurnoverService } from '../../transactions/services/bank-details-turnover.service';
import { AuthenticatedUser } from '../../common/types/token';
import { BankDetailsDto, toBankDetailsDto } from '../dto/bank-details.dto';
import { ListBankDetailsQueryDto } from '../dto/list-bank-details-query.dto';
import { SuperviseBankDetailsDto } from '../dto/supervise-bank-details.dto';

@ApiTags('Admin · Bank details')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/bank-details')
export class AdminBankDetailsController {
  constructor(
    private readonly bankDetails: BankDetailsService,
    private readonly turnover: BankDetailsTurnoverService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists the bank details of every account' })
  @ApiPagedResponse(BankDetailsDto)
  async list(
    @Query() query: ListBankDetailsQueryDto,
  ): Promise<Page<BankDetailsDto>> {
    const page =
      query.sortBy === BankDetailsSortField.TurnoverTotal
        ? await this.listByTurnover(query)
        : await this.bankDetails.list(query);

    return this.withTurnover(page);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one account’s bank details' })
  @ApiEnvelopeResponse(BankDetailsDto)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BankDetailsDto> {
    const found = await this.bankDetails.findById(id);

    if (!found) throw new NotFoundException('Bank details not found');

    return this.withTurnoverOf(found);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({ summary: 'Switches any account’s bank details on' })
  @ApiEnvelopeResponse(BankDetailsDto)
  async enable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<BankDetailsDto> {
    return this.withTurnoverOf(
      await this.bankDetails.supervise(id, { active: true }, admin.id),
    );
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({ summary: 'Switches any account’s bank details off' })
  @ApiEnvelopeResponse(BankDetailsDto)
  async disable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<BankDetailsDto> {
    return this.withTurnoverOf(
      await this.bankDetails.supervise(id, { active: false }, admin.id),
    );
  }

  @Delete(':id')
  @WriteAccess()
  @ApiOperation({
    summary: 'Deletes any account’s bank details',
    description:
      'A soft delete: the row stays and stops being listed, so what an order pointed at is not erased.',
  })
  @ApiEnvelopeResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<void> {
    await this.bankDetails.delete(id, admin.id);
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({ summary: 'Bans any account’s bank details, or lifts a ban' })
  @ApiEnvelopeResponse(BankDetailsDto)
  async supervise(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuperviseBankDetailsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<BankDetailsDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return this.withTurnoverOf(
      await this.bankDetails.supervise(id, dto, admin.id),
    );
  }

  private async listByTurnover(
    query: ListBankDetailsQueryDto,
  ): Promise<Page<BankDetails>> {
    const ids = await this.bankDetails.listIds(query);
    const pageIds = await this.turnover.pageOfBankDetailsByTurnover(
      ids,
      sortDirection(query.sortOrder),
      (query.page - 1) * query.limit,
      query.limit,
    );

    return toPage(
      [await this.bankDetails.findByIdsInOrder(pageIds), ids.length],
      query,
    );
  }

  private async withTurnover(
    page: Page<BankDetails>,
  ): Promise<Page<BankDetailsDto>> {
    const turnover = await this.turnover.turnoverOfBankDetails(
      page.items.map((row) => row.id),
      new Date(),
    );
    const { counterpartyMinAmount } = this.bankDetails;

    return page.map((row) =>
      toBankDetailsDto(row, counterpartyMinAmount, turnover.get(row.id)),
    );
  }

  private async withTurnoverOf(details: BankDetails): Promise<BankDetailsDto> {
    const turnover = await this.turnover.turnoverOfBankDetails(
      [details.id],
      new Date(),
    );

    return toBankDetailsDto(
      details,
      this.bankDetails.counterpartyMinAmount,
      turnover.get(details.id),
    );
  }
}
