import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import { DebtsService } from '../../debts/services/debts.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { DebtEventDto, toDebtEventDto } from '../dto/debt-event.dto';
import { DebtDto, toDebtDto } from '../dto/debt.dto';
import { IssueDebtDto } from '../dto/issue-debt.dto';
import { ListDebtEventsQueryDto } from '../dto/list-debt-events-query.dto';
import { ListDebtsQueryDto } from '../dto/list-debts-query.dto';
import { UpdateDebtDto } from '../dto/update-debt.dto';
import { WriteOffDebtDto } from '../dto/write-off-debt.dto';
import { canIssueRole } from '../utils/can-issue-role';

const MAX_DEBT_ID = 2147483647;

const assertDebtIdInRange = (id: number): void => {
  if (id < 1 || id > MAX_DEBT_ID) {
    throw new BadRequestException('Debt id is out of range');
  }
};

@ApiTags('Admin · Debts')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Superadmin)
@Controller('admin')
export class AdminDebtsController {
  constructor(
    private readonly debts: DebtsService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Post('users/:id/debts')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Lends USDT to an account: credits the main balance and opens a debt',
  })
  @ApiEnvelopeResponse(DebtDto, { status: HttpStatus.CREATED })
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueDebtDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DebtDto> {
    if (admin.id === id) {
      throw new ForbiddenException('Cannot lend to your own account');
    }

    const debtor = await this.directory.findById(id);

    if (!debtor) throw new NotFoundException('User not found');

    if (!canIssueRole(admin.role, debtor.role)) {
      throw new ForbiddenException(`Cannot act on a ${debtor.role}`);
    }

    return toDebtDto(await this.debts.issue(id, dto.amount, admin.id));
  }

  @Get('debts')
  @ApiOperation({ summary: 'Lists every debt, one row per issuance' })
  @ApiPagedResponse(DebtDto)
  async list(@Query() query: ListDebtsQueryDto): Promise<Page<DebtDto>> {
    return (await this.debts.list(query)).map(toDebtDto);
  }

  @Get('debts/:id/events')
  @ApiOperation({ summary: 'Lists the issuance and write-offs of one debt' })
  @ApiPagedResponse(DebtEventDto)
  async events(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListDebtEventsQueryDto,
  ): Promise<Page<DebtEventDto>> {
    assertDebtIdInRange(id);

    return (await this.debts.listEvents(id, query)).map(toDebtEventDto);
  }

  @Post('debts/:id/write-off')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary:
      'Withholds part or all of the remaining debt from the main balance, which may go negative',
  })
  @ApiEnvelopeResponse(DebtDto)
  async writeOff(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WriteOffDebtDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DebtDto> {
    assertDebtIdInRange(id);

    return toDebtDto(await this.debts.writeOff(id, dto.amount, admin.id));
  }

  @Patch('debts/:id')
  @WriteAccess()
  @ApiOperation({
    summary: 'Edits the comment and the auto write-off of a debt',
  })
  @ApiEnvelopeResponse(DebtDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDebtDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DebtDto> {
    assertDebtIdInRange(id);

    if (
      dto.comment === undefined &&
      dto.autoWriteOffAt === undefined &&
      dto.autoWriteOffPaused === undefined
    ) {
      throw new BadRequestException('No changes were given');
    }

    return toDebtDto(await this.debts.update(id, dto, admin.id));
  }
}
