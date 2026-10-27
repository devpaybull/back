import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { MerchantAttachmentsService } from '../../merchants/services/merchant-attachments.service';
import {
  MerchantAttachmentDto,
  toMerchantAttachmentDto,
} from '../dto/merchant-attachment.dto';
import {
  MerchantAttachmentsDto,
  toMerchantAttachmentsDto,
} from '../dto/merchant-attachments.dto';
import { ReplaceAttachmentsDto } from '../dto/replace-attachments.dto';
import { UpdateAttachmentDto } from '../dto/update-attachment.dto';

@ApiTags('Admin · Merchant attachments')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/merchants/:id/attachments')
export class AdminMerchantAttachmentsController {
  constructor(private readonly attachments: MerchantAttachmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lists the traders and cascades attached to a merchant',
  })
  @ApiEnvelopeResponse(MerchantAttachmentsDto)
  async list(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantAttachmentsDto> {
    return toMerchantAttachmentsDto(await this.attachments.list(id));
  }

  @Put()
  @WriteAccess()
  @ApiOperation({
    summary:
      'Replaces the whole set of attached traders and cascades with their switches',
  })
  @ApiEnvelopeResponse(MerchantAttachmentsDto)
  async replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceAttachmentsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantAttachmentsDto> {
    return toMerchantAttachmentsDto(
      await this.attachments.replace(id, dto, admin.id),
    );
  }

  @Patch(':userId')
  @WriteAccess()
  @ApiOperation({
    summary: 'Flips the switches of one attached trader or cascade',
  })
  @ApiEnvelopeResponse(MerchantAttachmentDto)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateAttachmentDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantAttachmentDto> {
    if (dto.trading === undefined && dto.methods === undefined) {
      throw new BadRequestException('No changes were given');
    }

    return toMerchantAttachmentDto(
      await this.attachments.update(id, userId, dto, admin.id),
    );
  }

  @Delete(':userId')
  @WriteAccess()
  @ApiOperation({ summary: 'Detaches one trader or cascade from the merchant' })
  @ApiEnvelopeResponse(MerchantAttachmentsDto)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantAttachmentsDto> {
    return toMerchantAttachmentsDto(
      await this.attachments.remove(id, userId, admin.id),
    );
  }
}
