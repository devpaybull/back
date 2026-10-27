import { KeyKind } from './key-kind';

export interface KeyMaterialSource {
  read(kind: KeyKind): Promise<Buffer>;
}

export const KEY_MATERIAL_SOURCE = Symbol('KEY_MATERIAL_SOURCE');
