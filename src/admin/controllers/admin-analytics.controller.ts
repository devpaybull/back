import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from '../../analytics/analytics.service';
import {
  DealsAnalyticsDto,
  PayInAnalyticsDto,
  VolumeAnalyticsDto,
} from '../../analytics/dto/analytics.dto';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { UserDirectoryService } from '../../users/services/user-directory.service';

@ApiTags('Admin · Analytics')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/users/:id/analytics')
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly directory: UserDirectoryService,
  ) {}

  @Get('pay-in')
  @ApiOperation({
    summary: 'Pay-in conversion and dispute analytics (14 days)',
  })
  @ApiEnvelopeResponse(PayInAnalyticsDto)
  async payIn(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PayInAnalyticsDto> {
    await this.requireUser(id);

    return this.analytics.payIn(id);
  }

  @Get('deals')
  @ApiOperation({ summary: 'Deal outcome analytics (14 days)' })
  @ApiEnvelopeResponse(DealsAnalyticsDto)
  async deals(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DealsAnalyticsDto> {
    await this.requireUser(id);

    return this.analytics.deals(id);
  }

  @Get('volume')
  @ApiOperation({ summary: 'Volume analytics (14 days)' })
  @ApiEnvelopeResponse(VolumeAnalyticsDto)
  async volume(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VolumeAnalyticsDto> {
    await this.requireUser(id);

    return this.analytics.volume(id);
  }

  private async requireUser(id: string): Promise<void> {
    const user = await this.directory.findById(id);

    if (!user) throw new NotFoundException('User not found');
  }
}
