import { UserSortField } from './user-sort-field.enum';

export type TradingSortField =
  UserSortField.Balance | UserSortField.InsuranceMin | UserSortField.Rate;
