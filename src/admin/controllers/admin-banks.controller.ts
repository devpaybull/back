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
import { BanksService } from '../../banks/banks.service';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { BankDto, toBankDto } from '../dto/bank.dto';
import { CreateBankDto } from '../dto/create-bank.dto';
import { ListBanksQueryDto } from '../dto/list-banks-query.dto';
import { UpdateBankDto } from '../dto/update-bank.dto';

@ApiTags('Admin · Banks')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/banks')
export class AdminBanksController {
  constructor(private readonly banks: BanksService) {}

  @Post()
  @WriteAccess()
  @ApiOperation({ summary: 'Adds a bank' })
  @ApiEnvelopeResponse(BankDto, { status: HttpStatus.CREATED })
  async create(@Body() dto: CreateBankDto): Promise<BankDto> {
    return toBankDto(await this.banks.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'Lists banks' })
  @ApiPagedResponse(BankDto)
  async list(@Query() query: ListBanksQueryDto): Promise<Page<BankDto>> {
    return (await this.banks.list(query)).map(toBankDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one bank' })
  @ApiEnvelopeResponse(BankDto)
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<BankDto> {
    const bank = await this.banks.findById(id);

    if (!bank) throw new NotFoundException('Bank not found');

    return toBankDto(bank);
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({ summary: 'Updates a bank' })
  @ApiEnvelopeResponse(BankDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBankDto,
  ): Promise<BankDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return toBankDto(await this.banks.update(id, dto));
  }
}
