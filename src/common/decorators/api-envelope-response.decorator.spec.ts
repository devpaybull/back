import { Controller, Get, HttpStatus, INestApplication } from '@nestjs/common';
import {
  ApiProperty,
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ApiEnvelopeResponse } from './api-envelope-response.decorator';

class SampleDto {
  @ApiProperty()
  id: number;
}

@Controller('samples')
class SamplesController {
  @Get('one')
  @ApiEnvelopeResponse(SampleDto)
  one() {
    return null;
  }

  @Get('many')
  @ApiEnvelopeResponse(SampleDto, { isArray: true })
  many() {
    return null;
  }

  @Get('empty')
  @ApiEnvelopeResponse()
  empty() {
    return null;
  }

  @Get('created')
  @ApiEnvelopeResponse(SampleDto, {
    status: HttpStatus.CREATED,
    description: 'Sample created',
  })
  created() {
    return null;
  }
}

describe('ApiEnvelopeResponse', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  const responseOf = (path: string, status: string) => {
    const response = document.paths[path].get.responses[status];

    if (!('content' in response)) {
      throw new Error(`${path} ${status} is a $ref, not a response object`);
    }

    return response;
  };

  const schemaOf = (path: string, status: string) =>
    responseOf(path, status).content['application/json'].schema;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SamplesController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents the envelope around a single model', () => {
    expect(schemaOf('/samples/one', '200')).toEqual({
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/SampleDto' } },
    });
  });

  it('registers the model in components so the $ref resolves', () => {
    expect(document.components.schemas.SampleDto).toBeDefined();
  });

  it('documents the envelope around an array of models', () => {
    expect(schemaOf('/samples/many', '200')).toEqual({
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/SampleDto' },
        },
      },
    });
  });

  it('documents an empty envelope when no model is given', () => {
    expect(schemaOf('/samples/empty', '200')).toEqual({
      type: 'object',
      required: ['data'],
      properties: { data: { nullable: true, example: null } },
    });
  });

  it('honours a custom status code and description', () => {
    expect(responseOf('/samples/created', '201').description).toBe(
      'Sample created',
    );
    expect(schemaOf('/samples/created', '201')).toEqual({
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/SampleDto' } },
    });
    expect(
      document.paths['/samples/created'].get.responses['200'],
    ).toBeUndefined();
  });
});
