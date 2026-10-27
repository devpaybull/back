import { AccountTransactionsService } from '../../account-transactions/services/account-transactions.service';
import { AccountTransactionListQuery } from '../../account-transactions/types/account-transaction-list-query';
import { AccountTransactionSortField } from '../../account-transactions/types/account-transaction-sort-field.enum';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
import { toInstant } from '../../common/utils/to-instant';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { ListAccountTransactionsQueryDto } from '../dto/list-account-transactions-query.dto';

export const toAccountTransactionListQuery = async (
  type: AccountTransactionType,
  query: ListAccountTransactionsQueryDto,
  directory: UserDirectoryService,
  operations: AccountTransactionsService,
  timeZone: string,
): Promise<AccountTransactionListQuery> => {
  const search = query.search?.trim();
  const matchedUserIds =
    search && !/^\d+$/.test(search)
      ? await directory.findIdsMatching(search)
      : undefined;
  const base: AccountTransactionListQuery = {
    type,
    page: query.page,
    limit: query.limit,
    sortOrder: query.sortOrder,
    sortBy: query.sortBy,
    status: query.status,
    statusReason: query.statusReason,
    userId: query.userId,
    createdFrom: toInstant(query.createdFrom, timeZone),
    createdTo: toInstant(query.createdTo, timeZone),
    search,
    matchedUserIds,
  };

  if (query.sortBy !== AccountTransactionSortField.User) return base;

  return {
    ...base,
    userRanks: await directory.rankByLogin(await operations.userIdsOf(base)),
  };
};
