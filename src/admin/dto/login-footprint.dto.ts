import { ApiProperty } from '@nestjs/swagger';
import { LoginFootprintRecord } from '../../auth/types/login-footprint-record';

export class LoginFootprintDto {
  @ApiProperty({ example: '203.0.113.7' })
  ip: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'DE',
    description: 'ISO 3166-1 alpha-2; null when it could not be resolved.',
  })
  country: string | null;

  @ApiProperty({ nullable: true, type: String })
  fingerprint: string | null;

  @ApiProperty({ nullable: true, type: String })
  userAgent: string | null;

  @ApiProperty()
  firstSeenAt: Date;

  @ApiProperty()
  lastSeenAt: Date;

  @ApiProperty({
    description:
      'Distinct accounts that logged in with the same ip, fingerprint and user agent, this one included.',
  })
  seenOnAccounts: number;
}

export const toLoginFootprintDto = (
  record: LoginFootprintRecord,
): LoginFootprintDto => ({
  ip: record.ip,
  country: record.country,
  fingerprint: record.fingerprint,
  userAgent: record.userAgent,
  firstSeenAt: record.firstSeenAt,
  lastSeenAt: record.lastSeenAt,
  seenOnAccounts: record.seenOnAccounts,
});
