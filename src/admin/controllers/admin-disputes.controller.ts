import { StoredIdPipe } from '../../common/pipes/stored-id.pipe';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { toFiat } from '../../common/utils/to-fiat';
import { DisputeDto, toDisputeDto } from '../../transactions/dto/dispute.dto';
import { TransactionDispute } from '../../transactions/entities/transaction-dispute.entity';
import { DisputesService } from '../../transactions/services/disputes.service';
import { TransactionFilesService } from '../../transactions/services/transaction-files.service';
import { ListDisputesQueryDto } from '../dto/list-disputes-query.dto';
import { AcceptDisputeDto, RejectDisputeDto } from '../dto/resolve-dispute.dto';

@ApiTags('Admin · Disputes')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly files: TransactionFilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists the disputes of every deal, newest first' })
  @ApiPagedResponse(DisputeDto)
  async list(@Query() query: ListDisputesQueryDto): Promise<Page<DisputeDto>> {
    const page = await this.disputes.list({
      page: query.page,
      limit: query.limit,
      sortOrder: query.sortOrder,
      statuses: query.status,
      transactionId: query.transactionId,
      traderUserId: query.traderUserId,
    });

    return new Page(await this.toDtos(page.items), page.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One dispute with its files' })
  @ApiEnvelopeResponse(DisputeDto)
  async findOne(
    @Param('id', ParseIntPipe, new StoredIdPipe('Dispute')) id: number,
  ): Promise<DisputeDto> {
    const [dto] = await this.toDtos([await this.disputes.findOne(id)]);

    return dto;
  }

  @Post(':id/accept')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decides a dispute for the client',
    description:
      'A pay-in closes as success or success_changed and the trader pays the difference; a pay-out is canceled, its money returned to the merchant — except a canceled pay-out an admin disputed, which becomes success (the trader is paid, the merchant charged; a balance that does not cover it needs confirmOverdraft, else 409 OVERDRAFT_NOT_CONFIRMED).',
  })
  @ApiEnvelopeResponse(DisputeDto)
  async accept(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseIntPipe, new StoredIdPipe('Dispute')) id: number,
    @Body() dto: AcceptDisputeDto,
  ): Promise<DisputeDto> {
    const [accepted] = await this.toDtos([
      await this.disputes.acceptByAdmin(
        admin.id,
        id,
        dto.amount === undefined ? null : toFiat(dto.amount),
        new Date(),
        dto.confirmOverdraft ?? false,
      ),
    ]);

    return accepted;
  }

  @Post(':id/reject')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refuses a dispute: the deal returns to its earlier status',
    description: 'No money moves.',
  })
  @ApiEnvelopeResponse(DisputeDto)
  async reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseIntPipe, new StoredIdPipe('Dispute')) id: number,
    @Body() dto: RejectDisputeDto,
  ): Promise<DisputeDto> {
    const [rejected] = await this.toDtos([
      await this.disputes.rejectByAdmin(admin.id, id, dto.reason),
    ]);

    return rejected;
  }

  private async toDtos(rows: TransactionDispute[]): Promise<DisputeDto[]> {
    const files = await this.files.listOf(rows.map((row) => row.transactionId));

    return rows.map((row) => toDisputeDto(row, files));
  }
}
