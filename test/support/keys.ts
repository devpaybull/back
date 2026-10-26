import { TronWeb, utils } from 'tronweb';

export const DEPOSIT_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const HOT_KEY = '0'.repeat(63) + '1';
export const ENERGY_KEY = '0'.repeat(63) + '2';
export const HOT_ADDRESS = TronWeb.address.fromPrivateKey(HOT_KEY) as string;
export const EXTERNAL_SENDER = TronWeb.address.fromPrivateKey(
  '0'.repeat(63) + '9',
) as string;
export const ENERGY_ADDRESS = TronWeb.address.fromPrivateKey(
  ENERGY_KEY,
) as string;

export const CIPHERTEXTS = {
  TRON_DEPOSIT_SEED_CIPHERTEXT: 'vault:v1:seed',
  TRON_HOT_KEY_CIPHERTEXT: 'vault:v1:hot',
  TRON_ENERGY_KEY_CIPHERTEXT: 'vault:v1:energy',
};

export const PLAINTEXTS: Record<string, string> = {
  'vault:v1:seed': DEPOSIT_MNEMONIC,
  'vault:v1:hot': HOT_KEY,
  'vault:v1:energy': ENERGY_KEY,
};

export const depositAddressAt = (index: number): string =>
  utils.accounts.generateAccountWithMnemonic(
    DEPOSIT_MNEMONIC,
    `m/44'/195'/0'/0/${index}`,
  ).address;
