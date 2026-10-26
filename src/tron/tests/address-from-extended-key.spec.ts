import { utils } from 'tronweb';
import { addressFromExtendedKey } from '../utils/address-from-extended-key';
import { DEPOSIT_ACCOUNT_PATH } from '../utils/deposit-account-path';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('addressFromExtendedKey', () => {
  const extendedKey = utils.ethersUtils.ethersHDNodeWallet
    .fromPhrase(MNEMONIC, undefined, DEPOSIT_ACCOUNT_PATH)
    .neuter().extendedKey;

  it('derives the BIP-44 coin 195 vector from the public account key', () => {
    expect(addressFromExtendedKey(extendedKey, 0)).toBe(
      'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
    );
    expect(addressFromExtendedKey(extendedKey, 1)).toBe(
      'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
    );
  });

  it('agrees with deriving from the private seed', () => {
    expect(addressFromExtendedKey(extendedKey, 7)).toBe(
      utils.accounts.generateAccountWithMnemonic(
        MNEMONIC,
        `${DEPOSIT_ACCOUNT_PATH}/0/7`,
      ).address,
    );
  });

  it('needs no private material: the key is an xpub', () => {
    expect(extendedKey.startsWith('xpub')).toBe(true);
  });
});
