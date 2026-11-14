import { ApiProperty } from '@nestjs/swagger';

export class DeviceMessageTraderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;

  @ApiProperty({ nullable: true })
  telegramUsername: string | null;
}
