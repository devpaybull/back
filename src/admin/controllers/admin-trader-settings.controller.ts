import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { toCrypto } from '../../common/utils/to-crypto';
import {
  TraderSettingsDto,
  toTraderSettingsDto,
} from '../../trader-settings/dto/trader-settings.dto';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { TraderSettingsChanges } from '../../trader-settings/types/trader-settings-changes';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UpdateTraderSettingsDto } from '../dto/update-trader-settings.dto';
import { canIssueRole } from '../utils/can-issue-role';

@ApiTags('Admin · Trader settings')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/users/:id/settings')
export class AdminTraderSettingsController {
  constructor(
    private readonly settings: TraderSettingsService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Reads an account’s trader settings' })
  @ApiEnvelopeResponse(TraderSettingsDto)
  async read(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TraderSettingsDto> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');

    const row = await this.settings.findOrDefaults(id);

    return toTraderSettingsDto(row, {
      insurancePayInMin: this.settings.insurancePayInMinOf(row),
      insurancePayOutMin: this.settings.insurancePayOutMinOf(row),
      nightStopThreshold: this.settings.nightStopThresholdOf(row),
    });
  }

  @Patch()
  @WriteAccess()
  @ApiOperation({ summary: 'Updates an account’s trader settings' })
  @ApiEnvelopeResponse(TraderSettingsDto)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTraderSettingsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<TraderSettingsDto> {
    const { reason, insurancePayInMin, insurancePayOutMin, ...flags } = dto;
    const toMinimum = (value: string | null) =>
      value === null ? null : toCrypto(value);
    const changes: TraderSettingsChanges = {
      ...flags,
      ...(insurancePayInMin !== undefined && {
        insurancePayInMin: toMinimum(insurancePayInMin),
      }),
      ...(insurancePayOutMin !== undefined && {
        insurancePayOutMin: toMinimum(insurancePayOutMin),
      }),
    };

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    const touchesAutoBuyback =
      changes.autoBuybackEnabled !== undefined ||
      changes.autoBuybackConcurrent !== undefined;

    if (touchesAutoBuyback && !reason) {
      throw new BadRequestException(
        'A reason is required to change auto-buyback',
      );
    }

    if (admin.id === id) {
      throw new ForbiddenException('Cannot edit your own account');
    }

    const target = await this.directory.findById(id);

    if (!target) throw new NotFoundException('User not found');

    if (!canIssueRole(admin.role, target.role)) {
      throw new ForbiddenException(`Cannot edit a ${target.role}`);
    }

    const row = await this.settings.update(id, changes, {
      actorUserId: admin.id,
      reason,
    });

    return toTraderSettingsDto(row, {
      insurancePayInMin: this.settings.insurancePayInMinOf(row),
      insurancePayOutMin: this.settings.insurancePayOutMinOf(row),
      nightStopThreshold: this.settings.nightStopThresholdOf(row),
    });
  }
}
