import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

export interface ApiEnvelopeResponseOptions {
  status?: HttpStatus;
  description?: string;
  isArray?: boolean;
}

export const ApiEnvelopeResponse = <TModel extends Type<unknown>>(
  model?: TModel,
  options: ApiEnvelopeResponseOptions = {},
) => {
  const { status = HttpStatus.OK, description, isArray = false } = options;

  const reference = model ? { $ref: getSchemaPath(model) } : undefined;

  const data = reference
    ? isArray
      ? { type: 'array', items: reference }
      : reference
    : { nullable: true, example: null };

  return applyDecorators(
    ...(model ? [ApiExtraModels(model)] : []),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['data'],
        properties: { data },
      },
    }),
  );
};
