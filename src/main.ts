import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NodeEnv } from './common/config/env.validation';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

const CORS_DISABLED = '';
const CORS_ANY_ORIGIN = '*';

function parseCorsOrigin(raw: string): boolean | string[] {
  const value = (raw ?? '').trim();
  if (value === CORS_DISABLED) return false;
  if (value === CORS_ANY_ORIGIN) return true;

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseTrustProxy(raw: string): boolean | number | string {
  const value = (raw ?? '').trim();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;

  const proxyHops = Number(value);

  return Number.isInteger(proxyHops) ? proxyHops : value;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY')));

  app.enableCors({
    origin: parseCorsOrigin(config.get<string>('CORS_ORIGIN')),
    credentials: config.get<boolean>('CORS_CREDENTIALS'),
  });

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
      .build();

    SwaggerModule.setup(
      'api',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  await app.listen(config.get<number>('PORT'));
}
void bootstrap();
