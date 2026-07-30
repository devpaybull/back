import { IssuedSession } from './token-payloads';

export interface StartedRegistrationResult {
  registrationToken: string;
  expiresIn: number;
  otpauthUrl: string;
  secret: string;
  qrCode: string;
}

export interface StartedTwoFactorSetupResult {
  setupToken: string;
  expiresIn: number;
  otpauthUrl: string;
  secret: string;
  qrCode: string;
}

export interface IssuedSessionWithBackupCodes {
  session: IssuedSession;
  backupCodes: string[];
}
