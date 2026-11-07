import { ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ValidationFailedException } from '../exceptions/validation-failed.exception';

export class FieldErrorsValidationPipe extends ValidationPipe {
  public createExceptionFactory() {
    return (errors: ValidationError[] = []) =>
      new ValidationFailedException(
        this.flattenValidationErrors(errors),
        errors,
      );
  }
}
