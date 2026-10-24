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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { CurrenciesService } from '../../currencies/currencies.service';
import { CreateCurrencyDto } from '../dto/create-currency.dto';
import { CurrencyDto, toCurrencyDto } from '../dto/currency.dto';
import { UpdateCurrencyDto } from '../dto/update-currency.dto';

@ApiTags('Admin · Currencies')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/currencies')
export class AdminCurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Post()
  @WriteAccess()
  @ApiOperation({ summary: 'Adds a currency' })
  @ApiEnvelopeResponse(CurrencyDto, { status: HttpStatus.CREATED })
  async create(@Body() dto: CreateCurrencyDto): Promise<CurrencyDto> {
    return toCurrencyDto(await this.currencies.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'Lists every currency' })
  @ApiEnvelopeResponse(CurrencyDto, { isArray: true })
  async list(): Promise<CurrencyDto[]> {
    return (await this.currencies.list()).map(toCurrencyDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one currency' })
  @ApiEnvelopeResponse(CurrencyDto)
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<CurrencyDto> {
    const currency = await this.currencies.findById(id);

    if (!currency) throw new NotFoundException('Currency not found');

    return toCurrencyDto(currency);
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({ summary: 'Updates a currency' })
  @ApiEnvelopeResponse(CurrencyDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCurrencyDto,
  ): Promise<CurrencyDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return toCurrencyDto(await this.currencies.update(id, dto));
  }
}
