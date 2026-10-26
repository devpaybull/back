import { ApiProperty } from '@nestjs/swagger';

export class AccountTransactionPartyDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  login: string;

  @ApiProperty({ type: String, nullable: true })
  telegramUsername: string | null;
}
