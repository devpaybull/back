import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { PageMeta } from '../types/page';

export interface ApiPagedResponseOptions {
  status?: HttpStatus;
  description?: string;
}

export const ApiPagedResponse = <TModel extends Type<unknown>>(
  model: TModel,
  options: ApiPagedResponseOptions = {},
) => {
  const { status = HttpStatus.OK, description } = options;

  return applyDecorators(
    ApiExtraModels(model, PageMeta),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PageMeta) },
        },
      },
    }),
  );
};
