import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { Response } from 'express';
import { ValidationFailedException } from '../../common/exceptions/validation-failed.exception';
import { NoRequisiteFoundError } from '../../transactions/exceptions/no-requisite-found.exception';
import { MerchantApiErrorBody } from '../types/merchant-api-error-body';
import { MerchantApiErrorCode } from '../types/merchant-api-error-code.enum';
import { MerchantApiFieldError } from '../types/merchant-api-field-error';

const KNOWN_CODES: ReadonlySet<string> = new Set(
  Object.values(MerchantApiErrorCode),
);

const fieldErrorsOf = (
  errors: ValidationError[],
  parentPath?: string,
): MerchantApiFieldError[] =>
  errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.keys(error.constraints ?? {}).map((code) => ({
      field,
      code,
    }));

    return [...own, ...fieldErrorsOf(error.children ?? [], field)];
  });

@Catch()
export class MerchantApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MerchantApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = this.toBody(exception);

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(body.statusCode)
      .json(body);
  }

  private toBody(exception: unknown): MerchantApiErrorBody {
    if (exception instanceof ValidationFailedException) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: MerchantApiErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: fieldErrorsOf(exception.validationErrors),
      };
    }

    if (exception instanceof NoRequisiteFoundError) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        code: MerchantApiErrorCode.NoRequisiteFoundForThisAmount,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        typeof response.code === 'string' &&
        KNOWN_CODES.has(response.code)
      ) {
        const message =
          'message' in response && typeof response.message === 'string'
            ? response.message
            : exception.message;

        return {
          statusCode: exception.getStatus(),
          code: response.code as MerchantApiErrorCode,
          message,
          ...('details' in response && response.details !== undefined
            ? { details: response.details }
            : {}),
        };
      }

      if (exception.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
        return {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          code: MerchantApiErrorCode.FileTooLarge,
          message: exception.message,
        };
      }

      if (exception.getStatus() === HttpStatus.BAD_REQUEST) {
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: MerchantApiErrorCode.ValidationFailed,
          message: exception.message,
        };
      }
    }

    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: MerchantApiErrorCode.InternalError,
      message: 'Internal server error',
    };
  }
}
