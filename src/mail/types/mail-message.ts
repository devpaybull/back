export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailConfirmationCodeMailInput {
  to: string;
  code: string;
  expiresAt: Date;
}

export interface PasswordRecoveryCodeMailInput {
  to: string;
  login: string;
  code: string;
  expiresAt: Date;
}
