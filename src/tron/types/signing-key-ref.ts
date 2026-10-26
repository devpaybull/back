export type SigningKeyRef =
  | { kind: 'hot' }
  | { kind: 'energy' }
  | { kind: 'deposit'; derivationIndex: number };
