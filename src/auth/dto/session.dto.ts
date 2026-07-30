import { ApiProperty } from '@nestjs/swagger';

export class SessionDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Access token lifetime in seconds' })
  expiresIn: number;
}

export class RegistrationStartedDto {
  @ApiProperty({ description: 'Carries the registration to its second step' })
  registrationToken: string;

  @ApiProperty({ description: 'Registration token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({
    example:
      'otpauth://totp/Paybull:user@example.com?secret=...&issuer=Paybull',
  })
  otpauthUrl: string;

  @ApiProperty({ description: 'Base32 secret behind the otpauth URL' })
  secret: string;

  @ApiProperty({
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
    description: 'The otpauth URL as a PNG data URI, usable as an img src',
  })
  qrCode: string;
}

export class TwoFactorSetupStartedDto {
  @ApiProperty({ description: 'Carries the re-enrolment to its second step' })
  setupToken: string;

  @ApiProperty({ description: 'Setup token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({
    example:
      'otpauth://totp/Paybull:user@example.com?secret=...&issuer=Paybull',
  })
  otpauthUrl: string;

  @ApiProperty({ description: 'Base32 secret behind the otpauth URL' })
  secret: string;

  @ApiProperty({
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
    description: 'The otpauth URL as a PNG data URI, usable as an img src',
  })
  qrCode: string;
}

export class SessionWithBackupCodesDto extends SessionDto {
  @ApiProperty({
    isArray: true,
    type: String,
    description: 'Shown once — each code replaces a one-time code at login',
  })
  backupCodes: string[];
}
