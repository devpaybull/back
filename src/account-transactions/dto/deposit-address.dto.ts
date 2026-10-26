import { ApiProperty } from '@nestjs/swagger';

export class DepositAddressDto {
  @ApiProperty({ example: 'TYZ5Mcnj...YYPa' })
  address: string;

  @ApiProperty({ example: 'TRC20' })
  network: string;

  @ApiProperty({ description: 'PNG data URI of the bare address' })
  qrCode: string;
}
