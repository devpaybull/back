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
import { RateService } from '../../transactions/services/rate.service';
import { RateScope } from '../../transactions/types/rate-scope.enum';
import { User } from '../../users/entities/user.entity';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { BaseRateSetDto, toBaseRateSetDto } from '../dto/base-rate-set.dto';
import { RateSetDto, toRateSetDto } from '../dto/rate-set.dto';
import { canIssueRole } from '../utils/can-issue-role';

const scopeOfUser = (user: User): RateScope => {
  if (user.role === Role.Trader) return RateScope.Trader;
  if (user.role === Role.LeadTrader) return RateScope.Lead;

  throw new BadRequestException(
    'Individual rates apply only to traders and lead traders',
  );
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
  ) {}

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

    const entries = dto.methods.map((method) => ({
      method: method.method,
      general: method.general ?? null,
      bands: method.bands,
    }));

    return toRateSetDto(
      await this.rates.replaceSubjectSet(scopeOfUser(user), id, entries, {
        actorUserId: admin.id,
      }),
    );
  }
}
