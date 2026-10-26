import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { TronUnavailableError } from '../types/tron-unavailable.error';

@Catch(TronUnavailableError)
export class TronUnavailableFilter implements ExceptionFilter {
  private readonly logger = new Logger(TronUnavailableFilter.name);

  catch(error: TronUnavailableError, host: ArgumentsHost): void {
    this.logger.warn(error.message);

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'The Tron network or the key store is unavailable, try again later',
        error: 'Service Unavailable',
      });
  }
}
