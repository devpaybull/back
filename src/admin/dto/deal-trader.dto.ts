import { ApiProperty } from '@nestjs/swagger';

export class DealTraderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;

  @ApiProperty({
    nullable: true,
    description: 'The trader’s Telegram groups, as an admin wrote them',
  })
  telegramGroups: string | null;
}
