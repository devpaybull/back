import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class JsonContentTypeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!request.is('application/json')) {
      throw new UnsupportedMediaTypeException(
        'Content-Type must be application/json',
      );
    }

    return true;
  }
}
