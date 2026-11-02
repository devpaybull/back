import { ApiProperty } from '@nestjs/swagger';

export class MerchantApiKeyRefDto {
  @ApiProperty()
  id: number;

  @ApiProperty({
    description: 'the key itself; the secret is never shown here',
  })
  key: string;

  @ApiProperty()
  createdAt: Date;
}

export class MerchantLinksDto {
  @ApiProperty({ type: String, nullable: true })
  supportLink: string | null;

  @ApiProperty({ type: String, nullable: true })
  callbackUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  successUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  errorUrl: string | null;

  @ApiProperty({
    type: MerchantApiKeyRefDto,
    nullable: true,
    description:
      'the newest active API key, read-only; issued and revoked by a superadmin',
  })
  apiKey: MerchantApiKeyRefDto | null;
}
