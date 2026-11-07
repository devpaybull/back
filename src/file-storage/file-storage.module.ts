import { Module } from '@nestjs/common';
import { S3FileStorage } from './s3-file-storage.service';
import { FileStorage } from './types/file-storage';

@Module({
  providers: [{ provide: FileStorage, useClass: S3FileStorage }],
  exports: [FileStorage],
})
export class FileStorageModule {}
