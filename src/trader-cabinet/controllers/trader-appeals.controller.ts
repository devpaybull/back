import { StoredIdPipe } from '../../common/pipes/stored-id.pipe';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
import { DisputeDto, toDisputeDto } from '../../transactions/dto/dispute.dto';
import { TransactionDispute } from '../../transactions/entities/transaction-dispute.entity';
import { DisputesService } from '../../transactions/services/disputes.service';
import { TransactionFilesService } from '../../transactions/services/transaction-files.service';
import { DisputeStatus } from '../../transactions/types/dispute-status.enum';
import { ContestAppealDto } from '../dto/contest-appeal.dto';
import { ListAppealsQueryDto } from '../dto/list-appeals-query.dto';
import { traderActorOf } from '../utils/trader-actor-of';

const VISIBLE_STATUSES = Object.values(DisputeStatus).filter(
  (status) => status !== DisputeStatus.Deferred,
);
const EVIDENCE_FILES_MAX = 5;

@ApiTags('Trader · Appeals')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader/appeals')
export class TraderAppealsController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly files: TransactionFilesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The disputes on the trader’s own deals, with their deadlines',
  })
  @ApiPagedResponse(DisputeDto)
  async list(
    @CurrentUser() trader: AuthenticatedUser,
    @Query() query: ListAppealsQueryDto,
  ): Promise<Page<DisputeDto>> {
    const statuses = query.status?.length
      ? query.status.filter((status) => status !== DisputeStatus.Deferred)
      : VISIBLE_STATUSES;

    if (statuses.length === 0) {
      throw new BadRequestException('A deferred dispute is not an appeal yet');
    }

    const page = await this.disputes.list({
      page: query.page,
      limit: query.limit,
      sortOrder: query.sortOrder,
      statuses,
      traderUserId: trader.id,
    });

    return new Page(await this.toDtos(page.items), page.meta);
  }

  @Post(':id/accept')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«Принять»: the dispute is decided in favour of the client',
    description:
      'A pay-in closes for the disputed amount and the trader pays; a pay-out is canceled and the trader gets nothing, or returns what was credited.',
  })
  @ApiEnvelopeResponse(DisputeDto)
  async accept(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseIntPipe, new StoredIdPipe('Dispute')) id: number,
  ): Promise<DisputeDto> {
    const [dto] = await this.toDtos([
      await this.disputes.acceptByTrader(traderActorOf(trader), id),
    ]);

    return dto;
  }

  @Post(':id/contest')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', EVIDENCE_FILES_MAX))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        comment: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary: '«Оспорить» with evidence: the dispute goes to an admin',
    description: 'The timer stops. At least one file is required.',
  })
  @ApiEnvelopeResponse(DisputeDto)
  async contest(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseIntPipe, new StoredIdPipe('Dispute')) id: number,
    @Body() dto: ContestAppealDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ): Promise<DisputeDto> {
    const [contested] = await this.toDtos([
      await this.disputes.contestByTrader(
        traderActorOf(trader),
        id,
        files.map((file) => ({
          buffer: file.buffer,
          name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        })),
        dto.comment || null,
      ),
    ]);

    return contested;
  }

  private async toDtos(rows: TransactionDispute[]): Promise<DisputeDto[]> {
    const files = await this.files.listOf(rows.map((row) => row.transactionId));

    return rows.map((row) => toDisputeDto(row, files));
  }
}
