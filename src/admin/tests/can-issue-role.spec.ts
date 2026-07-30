import { Role } from '../../common/enums/role.enum';
import { canIssueRole } from '../utils/can-issue-role';

const ALL_ROLES = Object.values(Role);

const NON_ADMINISTRATIVE_ROLES = [
  Role.Trader,
  Role.LeadTrader,
  Role.Merchant,
  Role.MerchantSupport,
  Role.MerchantAgent,
  Role.Cascade,
];

const ISSUERS_WITHOUT_ANY_POWER = NON_ADMINISTRATIVE_ROLES;

describe('canIssueRole', () => {
  it('covers every role of the enum in the matrix below', () => {
    expect(new Set(ALL_ROLES)).toEqual(
      new Set([...NON_ADMINISTRATIVE_ROLES, Role.Admin, Role.Superadmin]),
    );
  });

  describe('superadmin', () => {
    it.each(ALL_ROLES)('may issue %s', (target) => {
      expect(canIssueRole(Role.Superadmin, target)).toBe(true);
    });
  });

  describe('admin', () => {
    it.each(NON_ADMINISTRATIVE_ROLES)('may issue %s', (target) => {
      expect(canIssueRole(Role.Admin, target)).toBe(true);
    });

    it('may not issue admin', () => {
      expect(canIssueRole(Role.Admin, Role.Admin)).toBe(false);
    });

    it('may not issue superadmin', () => {
      expect(canIssueRole(Role.Admin, Role.Superadmin)).toBe(false);
    });
  });

  describe('every other role', () => {
    it.each(ISSUERS_WITHOUT_ANY_POWER)('%s may issue nothing', (issuer) => {
      const issuable = ALL_ROLES.filter((target) =>
        canIssueRole(issuer, target),
      );

      expect(issuable).toEqual([]);
    });
  });
});
