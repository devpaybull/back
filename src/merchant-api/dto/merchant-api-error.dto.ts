import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MerchantApiErrorCode } from '../types/merchant-api-error-code.enum';

export class MerchantApiErrorDto {
  @ApiProperty({ example: 403, description: 'the HTTP status, repeated' })
  statusCode: number;

  @ApiProperty({
    enum: MerchantApiErrorCode,
    enumName: 'MerchantApiErrorCode',
    example: MerchantApiErrorCode.NoRequisiteFoundForThisAmount,
  })
  code: MerchantApiErrorCode;

  @ApiProperty({ example: 'No requisite found for this amount' })
  message: string;

  @ApiPropertyOptional({
    description:
      'VALIDATION_FAILED: an array of { field, code }; DUPLICATE_MERCHANT_TRANSACTION_ID: { deal } with the deal under that key',
  })
  details?: unknown;
}
