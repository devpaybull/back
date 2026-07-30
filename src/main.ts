import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { REFRESH_COOKIE_NAME } from './auth/refresh-cookie';
import { NodeEnv } from './common/config/env.validation';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { parseCorsOrigin } from './common/utils/parse-cors-origin';
import { parseTrustProxy } from './common/utils/parse-trust-proxy';

async function bootstrap() {
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY')));

  app.enableCors({
    origin: parseCorsOrigin(config.get<string>('CORS_ORIGIN')),
    credentials: config.get<boolean>('CORS_CREDENTIALS'),
  });

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
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
      .build();

    SwaggerModule.setup(
      'api',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  const port = config.get<number>('PORT');

  await app.listen(port);

  logger.verbose(`Application is listening on the port ${port}`);
}
void bootstrap();
