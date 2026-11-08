import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { REFRESH_COOKIE_NAME } from './auth/refresh-cookie';
import { NodeEnv } from './common/config/env.validation';
import { FieldErrorsValidationPipe } from './common/pipes/field-errors-validation.pipe';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { parseCorsOrigin } from './common/utils/parse-cors-origin';
import { parseTrustProxy } from './common/utils/parse-trust-proxy';
import { buildMerchantApiDocument } from './merchant-api/utils/build-merchant-api-document';
import { registerBodyParsers } from './merchant-api/utils/register-body-parsers';

async function bootstrap() {
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);

  app.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY')));

  app.enableCors({
    origin: parseCorsOrigin(config.get<string>('CORS_ORIGIN')),
    credentials: config.get<boolean>('CORS_CREDENTIALS'),
  });

  app.use(cookieParser());
  registerBodyParsers(app);

  app.useGlobalPipes(
    new FieldErrorsValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

  if (config.get<NodeEnv>('NODE_ENV') !== NodeEnv.Production) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Paybull API')
      .setVersion('0.0.1')
      .addBearerAuth()
      .addCookieAuth(REFRESH_COOKIE_NAME)
      .addApiKey(
        { type: 'apiKey', in: 'header', name: 'X-Secure-Key' },
        'X-Secure-Key',
      )
      .build();

    SwaggerModule.setup(
      'api',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
    SwaggerModule.setup(
      'merchant-api-docs',
      app,
      buildMerchantApiDocument(app),
    );
  }

  const port = config.get<number>('PORT');

  await app.listen(port);

  logger.verbose(`Application is listening on the port ${port}`);
}
void bootstrap();
