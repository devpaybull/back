import { User } from '../entities/user.entity';

export interface StartedRegistration {
  user: User;
  secret: string;
  otpauthUrl: string;
}
