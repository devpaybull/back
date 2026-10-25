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
import { CountriesService } from '../../countries/countries.service';
import { CountryDto, toCountryDto } from '../dto/country.dto';
import { CreateCountryDto } from '../dto/create-country.dto';
import { UpdateCountryDto } from '../dto/update-country.dto';

@ApiTags('Admin · Countries')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/countries')
export class AdminCountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Post()
  @WriteAccess()
  @ApiOperation({ summary: 'Adds a country' })
  @ApiEnvelopeResponse(CountryDto, { status: HttpStatus.CREATED })
  async create(@Body() dto: CreateCountryDto): Promise<CountryDto> {
    return toCountryDto(await this.countries.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'Lists every country' })
  @ApiEnvelopeResponse(CountryDto, { isArray: true })
  async list(): Promise<CountryDto[]> {
    return (await this.countries.list()).map(toCountryDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one country' })
  @ApiEnvelopeResponse(CountryDto)
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<CountryDto> {
    const country = await this.countries.findById(id);

    if (!country) throw new NotFoundException('Country not found');

    return toCountryDto(country);
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({ summary: 'Renames a country' })
  @ApiEnvelopeResponse(CountryDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCountryDto,
  ): Promise<CountryDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return toCountryDto(await this.countries.update(id, dto));
  }
}
