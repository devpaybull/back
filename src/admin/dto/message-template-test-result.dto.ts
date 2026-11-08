import { ApiProperty } from '@nestjs/swagger';

export class MessageTemplateTestResultDto {
  @ApiProperty({ description: 'The pattern matched the text' })
  matched: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1500.00',
    description:
      'The amount group read as fiat; null when it did not match or is not an amount, and then the template would not recognise this text',
  })
  amount: string | null;
}
