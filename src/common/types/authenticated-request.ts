import { Request } from 'express';
import { AuthenticatedUser } from './token';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
