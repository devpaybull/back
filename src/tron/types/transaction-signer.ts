import { SigningKeyRef } from './signing-key-ref';
import { TronTransaction } from './tron-transaction';

export interface TransactionSigner {
  sign(
    transaction: TronTransaction,
    key: SigningKeyRef,
  ): Promise<TronTransaction>;
}

export const TRANSACTION_SIGNER = Symbol('TRANSACTION_SIGNER');
