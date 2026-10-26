import { Crypto } from '../../common/types/crypto';
import { SigningKeyRef } from './signing-key-ref';

export interface SendUsdtInput {
  idempotencyKey: string;
  from: SigningKeyRef;
  to: string;
  amount: Crypto;
}
