import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';
import { TOTP_PATTERN } from '../../common/utils/totp-pattern';

export class CreateWithdrawalDto {
  @ApiProperty({ type: String, example: '100.00' })
  @IsCryptoAmount({ positive: true })
  amount: string;

  @ApiProperty({ example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' })
  @IsString()
  @MaxLength(64)
  address: string;

  @ApiProperty({ example: '123456', description: 'The authenticator code' })
  @Matches(TOTP_PATTERN, { message: 'totp must be a 6-digit code' })
  totp: string;
}
