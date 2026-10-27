import { ApiProperty } from '@nestjs/swagger';
import { IsIP, IsString, MaxLength } from 'class-validator';

export class AddMerchantIpAddressDto {
  @ApiProperty({
    example: '203.0.113.47',
    description: 'one IPv4 or IPv6 address, no ranges',
  })
  @IsString()
  @MaxLength(45)
  @IsIP()
  ip: string;
}
