import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import {
  CounterpartyRequisiteDto,
  toCounterpartyRequisiteDto,
} from '../dto/counterparty-requisite.dto';
import { ListCounterpartyRequisitesQueryDto } from '../dto/list-counterparty-requisites-query.dto';

@ApiTags('Admin · Counterparties')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/counterparty-requisites')
export class AdminCounterpartyRequisitesController {
  constructor(private readonly bankDetails: BankDetailsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Searches counterparty-only requisites by card, phone or holder, for binding',
  })
  @ApiPagedResponse(CounterpartyRequisiteDto)
  async list(
    @Query() query: ListCounterpartyRequisitesQueryDto,
  ): Promise<Page<CounterpartyRequisiteDto>> {
    return (await this.bankDetails.listCounterpartyOnly(query)).map(
      toCounterpartyRequisiteDto,
    );
  }
}
