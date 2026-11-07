import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import {
  MerchantCallbackDto,
  toMerchantCallbackDto,
} from '../../merchant-callbacks/dto/merchant-callback.dto';
import { MerchantCallbacksService } from '../../merchant-callbacks/services/merchant-callbacks.service';

@ApiTags('Admin · Merchant callbacks')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin')
export class AdminMerchantCallbacksController {
  constructor(private readonly callbacks: MerchantCallbacksService) {}

  @Get('transactions/:id/callbacks')
  @ApiOperation({
    summary: 'The callbacks of one deal, in the order of events',
  })
  @ApiEnvelopeResponse(MerchantCallbackDto, { isArray: true })
  async listOfDeal(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantCallbackDto[]> {
    return (await this.callbacks.listOfDeal(id)).map(toMerchantCallbackDto);
  }

  @Post('merchant-callbacks/:id/resend')
  @WriteAccess()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sends a delivered or failed callback again',
    description: 'Anything else, or a second time within a minute, is a 409.',
  })
  @ApiEnvelopeResponse(MerchantCallbackDto)
  async resend(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantCallbackDto> {
    return toMerchantCallbackDto(await this.callbacks.resend(id));
  }
}
