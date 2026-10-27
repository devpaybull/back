import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { RateService } from '../../transactions/services/rate.service';
import { RateScope } from '../../transactions/types/rate-scope.enum';
import { TRANSACTION_METHODS } from '../../transactions/utils/transaction-methods';
import { User } from '../../users/entities/user.entity';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { BaseRateSetDto, toBaseRateSetDto } from '../dto/base-rate-set.dto';
import { RateSetDto, toRateSetDto } from '../dto/rate-set.dto';
import {
  toTransactionMethodDto,
  TransactionMethodDto,
} from '../dto/transaction-method.dto';
import { canIssueRole } from '../utils/can-issue-role';
import { toSubjectMethodRates } from '../utils/to-subject-method-rates';

const scopeOfUser = (user: User): RateScope => {
  if (user.role === Role.Trader) return RateScope.Trader;

  throw new BadRequestException('Individual rates apply only to traders');
};

@ApiTags('Admin · Rates')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller()
export class AdminRatesController {
  constructor(
    private readonly rates: RateService,
    private readonly directory: UserDirectoryService,
    private readonly merchants: MerchantsService,
  ) {}

  @Get('admin/methods')
  @ApiOperation({
    summary:
      'Lists the payment methods of the registry in code, with the currency and the rate kind of each',
  })
  @ApiEnvelopeResponse(TransactionMethodDto, { isArray: true })
  listMethods(): TransactionMethodDto[] {
    return TRANSACTION_METHODS.map(toTransactionMethodDto);
  }

  @Get('admin/rates/base/:scope')
  @ApiOperation({ summary: 'Reads the base rates of a scope' })
  @ApiEnvelopeResponse(BaseRateSetDto)
  async readBase(
    @Param('scope', new ParseEnumPipe(RateScope)) scope: RateScope,
  ): Promise<BaseRateSetDto> {
    return toBaseRateSetDto(await this.rates.getBaseSet(scope));
  }

  @Put('admin/rates/base/:scope')
  @WriteAccess()
  @ApiOperation({ summary: 'Replaces the base rates of a scope' })
  @ApiEnvelopeResponse(BaseRateSetDto)
  async replaceBase(
    @Param('scope', new ParseEnumPipe(RateScope)) scope: RateScope,
    @Body() dto: BaseRateSetDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<BaseRateSetDto> {
    return toBaseRateSetDto(
      await this.rates.replaceBaseSet(scope, dto.methods, {
        actorUserId: admin.id,
      }),
    );
  }

  @Get('admin/users/:id/rates')
  @ApiOperation({ summary: 'Reads an account’s individual rates' })
  @ApiEnvelopeResponse(RateSetDto)
  async readSubject(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RateSetDto> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    return toRateSetDto(await this.rates.getSubjectSet(scopeOfUser(user), id));
  }

  @Put('admin/users/:id/rates')
  @WriteAccess()
  @ApiOperation({ summary: 'Replaces an account’s individual rates' })
  @ApiEnvelopeResponse(RateSetDto)
  async replaceSubject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateSetDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<RateSetDto> {
    if (admin.id === id) {
      throw new ForbiddenException('Cannot edit your own account');
    }

    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    if (!canIssueRole(admin.role, user.role)) {
      throw new ForbiddenException(`Cannot edit a ${user.role}`);
    }

    const entries = toSubjectMethodRates(dto);

    return toRateSetDto(
      await this.rates.replaceSubjectSet(scopeOfUser(user), id, entries, {
        actorUserId: admin.id,
      }),
    );
  }

  @Get('admin/merchants/:id/rates')
  @ApiOperation({
    summary: 'Reads a merchant’s individual rates, set up like a trader’s',
  })
  @ApiEnvelopeResponse(RateSetDto)
  async readMerchant(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RateSetDto> {
    await this.requireMerchant(id);

    return toRateSetDto(await this.rates.getSubjectSet(RateScope.Merchant, id));
  }

  @Put('admin/merchants/:id/rates')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Replaces a merchant’s individual rates; they always apply over the base merchant set',
  })
  @ApiEnvelopeResponse(RateSetDto)
  async replaceMerchant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateSetDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<RateSetDto> {
    await this.requireMerchant(id);

    return toRateSetDto(
      await this.rates.replaceSubjectSet(
        RateScope.Merchant,
        id,
        toSubjectMethodRates(dto),
        { actorUserId: admin.id },
      ),
    );
  }

  private async requireMerchant(id: string): Promise<void> {
    if (!(await this.merchants.findById(id))) {
      throw new NotFoundException('Merchant not found');
    }
  }
}
