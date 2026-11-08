import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { attachmentDisposition } from '../../common/utils/attachment-disposition';
import { TransactionFilesService } from '../../transactions/services/transaction-files.service';
import { CurrentApiMerchant } from '../decorators/current-api-merchant.decorator';
import { DealFileDto } from '../dto/deal-file.dto';
import { UploadDealFileDto } from '../dto/upload-deal-file.dto';
import { MerchantApiErrorDto } from '../dto/merchant-api-error.dto';
import { MerchantApiExceptionFilter } from '../filters/merchant-api-exception.filter';
import { MerchantApiKeyGuard } from '../guards/merchant-api-key.guard';
import { ApiMerchant } from '../types/api-merchant';

@ApiTags('Merchant API · Disputes')
@ApiSecurity('X-Secure-Key')
@ApiDefaultResponse({
  type: MerchantApiErrorDto,
  description: 'An error: { statusCode, code, message, details? }',
})
@Public()
@UseGuards(MerchantApiKeyGuard)
@UseFilters(MerchantApiExceptionFilter)
@Controller('v1/files')
export class MerchantApiFilesController {
  constructor(private readonly files: TransactionFilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'dealId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        dealId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a receipt for a dispute on a deal',
    description:
      'The type is read from the content: pdf, png, jpeg, heic, heif, mp4, mov, 3gp, avi, mkv, webm, mpeg. Over the size limit is a 413.',
  })
  @ApiEnvelopeResponse(DealFileDto, { status: 201 })
  async upload(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Body() dto: UploadDealFileDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<DealFileDto> {
    if (!file) throw new BadRequestException('The file is required');

    const saved = await this.files.uploadForMerchant(
      merchant.merchantId,
      dto.dealId,
      {
        buffer: file.buffer,
        name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      },
    );

    return {
      fileKey: saved.id,
      name: saved.name,
      size: saved.size,
      mime: saved.mime,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Download a file the merchant uploaded',
    description: 'Always an attachment.',
  })
  @ApiOkResponse({ description: 'The file, not wrapped in the envelope' })
  async download(
    @CurrentApiMerchant() merchant: ApiMerchant,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { file, body } = await this.files.downloadForMerchant(
      merchant.merchantId,
      id,
    );

    return new StreamableFile(body, {
      type: file.mime,
      disposition: attachmentDisposition(file.name),
    });
  }
}
