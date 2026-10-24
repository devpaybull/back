import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { CounterpartiesService } from '../../counterparties/counterparties.service';
import { CounterpartyDto, toCounterpartyDto } from '../dto/counterparty.dto';
import { ListCounterpartiesQueryDto } from '../dto/list-counterparties-query.dto';

@ApiTags('Admin · Counterparties')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/counterparties')
export class AdminCounterpartiesController {
  constructor(private readonly counterparties: CounterpartiesService) {}

  @Get()
  @ApiOperation({ summary: 'Lists counterparties across every merchant' })
  @ApiPagedResponse(CounterpartyDto)
  async list(
    @Query() query: ListCounterpartiesQueryDto,
  ): Promise<Page<CounterpartyDto>> {
    return (await this.counterparties.list(query)).map(toCounterpartyDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one counterparty' })
  @ApiEnvelopeResponse(CounterpartyDto)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CounterpartyDto> {
    const found = await this.counterparties.findById(id);

    if (!found) throw new NotFoundException('Counterparty not found');

    return toCounterpartyDto(found);
  }
}
