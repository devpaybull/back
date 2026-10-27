import { ApiProperty } from '@nestjs/swagger';

export class MerchantIpAddressDto {
  @ApiProperty()
  id: number;

  @ApiProperty({
    example: '203.0.*.*',
    description:
      'the full address for a superadmin; masked for an admin (IPv4: the last two octets, IPv6: the last four groups)',
  })
  ip: string;

  @ApiProperty()
  masked: boolean;

  @ApiProperty()
  createdAt: Date;
}
