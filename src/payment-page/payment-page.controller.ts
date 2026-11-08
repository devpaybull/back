import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiDefaultResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../common/decorators/api-envelope-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  PaymentPageDto,
  PaymentPageReceiptDto,
} from '../transactions/dto/payment-page.dto';
import { PaymentPageService } from '../transactions/services/payment-page.service';
import { PayPageRateLimitGuard } from './guards/pay-page-rate-limit.guard';
import { PayReceiptGuard } from './guards/pay-receipt.guard';

@ApiTags('Payment page')
@ApiDefaultResponse({
  description:
    'An error: { statusCode, code, message } — PAYMENT_PAGE_NOT_FOUND (404), PAYMENT_NOT_PAYABLE (409), RECEIPT_LIMIT_REACHED (409), FILE_TYPE_NOT_ALLOWED (400), TOO_MANY_REQUESTS (429, with Retry-After), TOO_MANY_UPLOADS (429); a file over the size limit is a 413',
})
@ApiParam({
  name: 'token',
  description: 'The last segment of the deal’s paymentPageUrl',
})
@Public()
@UseGuards(PayPageRateLimitGuard)
@Controller('pay')
export class PaymentPageController {
  constructor(private readonly pages: PaymentPageService) {}

  @Get(':token')
  @ApiOperation({
    summary:
      'What the payer’s page shows: the amount, the requisite, the timer',
    description:
      'No key, no JWT: the token is the access. A final deal is shown for PAYMENT_PAGE_FINAL_TTL_HOURS after it was resolved; an unknown token and a deal past that are both 404 PAYMENT_PAGE_NOT_FOUND. Requests per client (an IPv6 /64 counts as one) are limited (429).',
  })
  @ApiEnvelopeResponse(PaymentPageDto)
  view(@Param('token') token: string): Promise<PaymentPageDto> {
    return this.pages.view(token);
  }

  @Post(':token/paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«Я оплатил»: the payer says the money is sent',
    description:
      'An active pay-in moves to checking; the timer keeps running, and at expiresAt the deal goes to checking_manually. Once per deal: a repeat answers the page as it is. 409 PAYMENT_NOT_PAYABLE when the deal is no longer waiting for the payer; 404 once it is final.',
  })
  @ApiEnvelopeResponse(PaymentPageDto)
  paid(@Param('token') token: string): Promise<PaymentPageDto> {
    return this.pages.markPaid(token);
  }

  @Post(':token/receipt')
  @UseGuards(PayReceiptGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'The payer uploads a receipt',
    description:
      'The type is read from the content: pdf, png, jpeg, heic, heif, mp4, mov, 3gp, avi, mkv, webm, mpeg. Over the size limit is a 413. At most 3 per deal (409 RECEIPT_LIMIT_REACHED). The token, the deal and the count are checked before the body is read; at most 2 uploads in progress per client (429 TOO_MANY_UPLOADS). The status does not change.',
  })
  @ApiEnvelopeResponse(PaymentPageReceiptDto, {
    status: HttpStatus.CREATED,
  })
  receipt(
    @Param('token') token: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<PaymentPageReceiptDto> {
    if (!file) throw new BadRequestException('The file is required');

    return this.pages.uploadReceipt(token, {
      buffer: file.buffer,
      name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
    });
  }
}
