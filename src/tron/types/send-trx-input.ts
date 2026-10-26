import { Crypto } from '../../common/types/crypto';
import { SigningKeyRef } from './signing-key-ref';

export interface SendTrxInput {
  idempotencyKey: string;
  from: SigningKeyRef;
  to: string;
  amount: Crypto;
}
