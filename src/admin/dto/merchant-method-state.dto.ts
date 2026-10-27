import { ApiProperty } from '@nestjs/swagger';

export class MerchantMethodStateDto {
  @ApiProperty({ example: 'sbp' })
  method: string;

  @ApiProperty()
  payInEnabled: boolean;

  @ApiProperty()
  payOutEnabled: boolean;
}
