import { ConfigService } from '@nestjs/config';
import { MulterModuleOptions } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

const TEXT_FIELDS_MAX = 2;
const TEXT_FIELD_MAX_BYTES = 4096;

export const dealFileUploadOptions = (
  config: ConfigService,
): MulterModuleOptions => {
  const files = config.getOrThrow<number>('DISPUTE_FILES_MAX');

  return {
    storage: memoryStorage(),
    limits: {
      files,
      fields: TEXT_FIELDS_MAX,
      parts: files + TEXT_FIELDS_MAX,
      fieldSize: TEXT_FIELD_MAX_BYTES,
      fileSize: config.getOrThrow<number>('DISPUTE_FILE_MAX_BYTES'),
    },
  };
};
