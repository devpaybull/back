import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { MerchantApiModule } from '../src/merchant-api/merchant-api.module';
import { buildMerchantApiDocument } from '../src/merchant-api/utils/build-merchant-api-document';
import { PaymentPageModule } from '../src/payment-page/payment-page.module';

const DEFAULT_OUTPUT = 'openapi/merchant-api.json';

@Global()
@Module({
  providers: [
    { provide: DataSource, useValue: null },
    { provide: ConfigService, useValue: null },
  ],
  exports: [DataSource, ConfigService],
})
class UninstantiatedInfrastructureModule {}

@Module({
  imports: [
    UninstantiatedInfrastructureModule,
    MerchantApiModule,
    PaymentPageModule,
  ],
})
class MerchantApiDocumentModule {}

async function main(): Promise<void> {
  const output = resolve(process.argv[2] ?? DEFAULT_OUTPUT);
  const app = await NestFactory.create(MerchantApiDocumentModule, {
    preview: true,
    abortOnError: false,
    logger: ['error'],
  });

  const document = buildMerchantApiDocument(app);
  await app.close();

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Merchant OpenAPI document written to ${output}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
