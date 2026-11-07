import { SetMetadata } from '@nestjs/common';

export const SKIP_IP_CHECK_METADATA_KEY = 'merchantApiSkipIpCheck';

export const SkipIpCheck = () => SetMetadata(SKIP_IP_CHECK_METADATA_KEY, true);
