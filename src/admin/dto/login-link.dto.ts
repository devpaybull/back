import { ApiProperty } from '@nestjs/swagger';

export class LoginLinkDto {
  @ApiProperty({
    description:
      'Single-use code. Shown once; only its SHA-256 hash is stored.',
  })
  code: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://app.example.com/login-link?code=...',
    description: 'Null when APP_URL is not configured',
  })
  url: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;
}
