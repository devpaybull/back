import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateBy,
} from 'class-validator';

const CODE_MAX = 64;
const CARD_NUMBER = /^\d{13,19}$/;
const E164_DIGITS = /^[1-9]\d{7,14}$/;

const passesLuhn = (digits: string): boolean => {
  let sum = 0;

  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index]);
    const doubled = index % 2 === 1 ? digit * 2 : digit;

    sum += doubled > 9 ? doubled - 9 : doubled;
  }

  return sum % 10 === 0;
};

const PassesLuhn = () =>
  ValidateBy({
    name: 'luhn',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && passesLuhn(value),
      defaultMessage: () => 'cardNumber fails the Luhn check',
    },
  });

export class PayOutRequisiteDto {
  @ApiProperty({ minLength: 1, maxLength: 255, example: 'IVAN IVANOV' })
  @IsString()
  @Length(1, 255)
  ownerName: string;

  @ApiProperty({
    example: 'tbank',
    description: 'An active bank’s code; an unknown one is 400 BANK_NOT_FOUND',
  })
  @IsString()
  @MaxLength(CODE_MAX)
  bank: string;

  @ApiPropertyOptional({
    pattern: CARD_NUMBER.source,
    example: '4111111111111111',
    description:
      '13–19 digits passing the Luhn check; required for card, refused for sbp',
  })
  @IsOptional()
  @IsString()
  @Matches(CARD_NUMBER)
  @PassesLuhn()
  cardNumber?: string;

  @ApiPropertyOptional({
    pattern: E164_DIGITS.source,
    example: '79001234567',
    description:
      'E.164 digits without the +; required for sbp, refused for card',
  })
  @IsOptional()
  @IsString()
  @Matches(E164_DIGITS)
  sbpNumber?: string;
}
