import { SetMetadata } from '@nestjs/common';

export const WRITE_ACCESS_METADATA_KEY = 'writeAccess';

export const WriteAccess = () => SetMetadata(WRITE_ACCESS_METADATA_KEY, true);
