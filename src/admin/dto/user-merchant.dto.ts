import { ApiProperty } from '@nestjs/swagger';

export class UserMerchantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}
