import { SetMetadata } from '@nestjs/common';

export const PUBLIC_METADATA_KEY = 'public';

export const Public = () => SetMetadata(PUBLIC_METADATA_KEY, true);
