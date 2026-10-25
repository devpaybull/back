export interface IssuedLoginLink {
  code: string;
  url: string | null;
  expiresAt: Date;
}
