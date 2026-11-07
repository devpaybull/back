import { ApiProperty } from '@nestjs/swagger';
import { MerchantRequestDto } from './merchant-request.dto';

export class MerchantRequestPartSizeDto {
  @ApiProperty({ description: 'UTF-8 bytes of the text as returned' })
  sizeBytes: number;

  @ApiProperty({ description: 'lines of the text as returned; 0 when empty' })
  lines: number;
}

export class MerchantRequestSizesDto {
  @ApiProperty({
    type: MerchantRequestPartSizeDto,
    description: 'requestHeaders as JSON with a two-space indent',
  })
  headers: MerchantRequestPartSizeDto;

  @ApiProperty({ type: MerchantRequestPartSizeDto })
  body: MerchantRequestPartSizeDto;

  @ApiProperty({ type: MerchantRequestPartSizeDto })
  response: MerchantRequestPartSizeDto;
}

export class MerchantRequestDetailDto extends MerchantRequestDto {
  @ApiProperty({ example: 'POST' })
  httpMethod: string;

  @ApiProperty({ example: '/v1/payment/pay-in' })
  path: string;

  @ApiProperty({
    nullable: true,
    description:
      'the client address: whole for a superadmin, masked for an admin',
  })
  ip: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'as sent, names lower-cased; X-Secure-Key masked, Authorization and Cookie dropped',
  })
  requestHeaders: Record<string, string>;

  @ApiProperty({
    nullable: true,
    description: 'the raw text the merchant sent',
  })
  requestBody: string | null;

  @ApiProperty({
    description:
      'the body was longer than MERCHANT_REQUEST_LOG_MAX_BYTES and is cut',
  })
  requestBodyTruncated: boolean;

  @ApiProperty({ nullable: true, description: 'the text we answered' })
  responseBody: string | null;

  @ApiProperty()
  responseBodyTruncated: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      '«Обработка»: the outcome of requisite selection for a creation — considered, dropped per filter, attempted, the issued requisite',
  })
  selectionSummary: Record<string, unknown> | null;

  @ApiProperty({ type: MerchantRequestSizesDto })
  sizes: MerchantRequestSizesDto;
}
