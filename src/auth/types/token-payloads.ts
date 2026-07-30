import { TokenType } from '../../common/types/token';

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: TokenType.Refresh;
}

export interface RegistrationTokenPayload {
  sub: string;
  login: string;
  inviteCode: string;
  type: TokenType.Registration;
}

export interface TwoFactorSetupTokenPayload {
  sub: string;
  login: string;
  type: TokenType.TwoFactorSetup;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}
