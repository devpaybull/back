import { CreateDealInput } from './create-deal-input';

export type IssuedDealInput = Omit<
  CreateDealInput,
  'traderUserId' | 'bankDetailsId' | 'traderPercent' | 'bankId'
>;
