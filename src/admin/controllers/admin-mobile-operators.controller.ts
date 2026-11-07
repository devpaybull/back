import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { MobileOperatorsService } from '../../mobile-operators/mobile-operators.service';
import { CreateMobileOperatorDto } from '../dto/create-mobile-operator.dto';
import { ListMobileOperatorsQueryDto } from '../dto/list-mobile-operators-query.dto';
import {
  MobileOperatorDto,
  toMobileOperatorDto,
} from '../dto/mobile-operator.dto';
import { UpdateMobileOperatorDto } from '../dto/update-mobile-operator.dto';

@ApiTags('Admin · Mobile operators')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/mobile-operators')
export class AdminMobileOperatorsController {
  constructor(private readonly operators: MobileOperatorsService) {}

  @Post()
  @WriteAccess()
  @ApiOperation({ summary: 'Adds a mobile operator' })
  @ApiEnvelopeResponse(MobileOperatorDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateMobileOperatorDto,
  ): Promise<MobileOperatorDto> {
    return toMobileOperatorDto(await this.operators.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'Lists mobile operators' })
  @ApiPagedResponse(MobileOperatorDto)
  async list(
    @Query() query: ListMobileOperatorsQueryDto,
  ): Promise<Page<MobileOperatorDto>> {
    return (await this.operators.list(query)).map(toMobileOperatorDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one mobile operator' })
  @ApiEnvelopeResponse(MobileOperatorDto)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MobileOperatorDto> {
    const operator = await this.operators.findById(id);

    if (!operator) throw new NotFoundException('Mobile operator not found');

    return toMobileOperatorDto(operator);
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({ summary: 'Updates a mobile operator' })
  @ApiEnvelopeResponse(MobileOperatorDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMobileOperatorDto,
  ): Promise<MobileOperatorDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return toMobileOperatorDto(await this.operators.update(id, dto));
  }
}
