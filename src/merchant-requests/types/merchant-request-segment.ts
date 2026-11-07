import { MerchantRequestSummary } from './merchant-request-summary';

export type MerchantRequestSegment = (
  skip: number,
  take: number,
) => Promise<[MerchantRequestSummary[], number]>;
