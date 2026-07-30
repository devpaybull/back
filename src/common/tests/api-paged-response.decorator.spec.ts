import { Controller, Get, HttpStatus, INestApplication } from '@nestjs/common';
import {
  ApiProperty,
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ApiPagedResponse } from '../decorators/api-paged-response.decorator';

class SampleDto {
  @ApiProperty()
  id: number;
}

@Controller('samples')
class SamplesController {
  @Get('paged')
  @ApiPagedResponse(SampleDto)
  paged() {
    return null;
  }

  @Get('accepted')
  @ApiPagedResponse(SampleDto, {
    status: HttpStatus.ACCEPTED,
    description: 'Samples accepted',
  })
  accepted() {
    return null;
  }
}

describe('ApiPagedResponse', () => {
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

  it('documents the meta beside the data, not inside it', () => {
    expect(schemaOf('/samples/paged', '200')).toEqual({
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/SampleDto' },
        },
        meta: { $ref: '#/components/schemas/PageMeta' },
      },
    });
  });

  it('registers both models in components so the $refs resolve', () => {
    expect(document.components.schemas.SampleDto).toBeDefined();
    expect(document.components.schemas.PageMeta).toBeDefined();
  });

  it('describes the four counters of the meta', () => {
    const meta = document.components.schemas.PageMeta;

    if (!('properties' in meta)) {
      throw new Error('PageMeta is a $ref, not a schema object');
    }

    expect(Object.keys(meta.properties).sort()).toEqual([
      'limit',
      'page',
      'pages',
      'total',
    ]);
  });

  it('honours a custom status code and description', () => {
    expect(responseOf('/samples/accepted', '202').description).toBe(
      'Samples accepted',
    );
    expect(
      document.paths['/samples/accepted'].get.responses['200'],
    ).toBeUndefined();
  });
});
