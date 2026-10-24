import { MethodPercent } from './method-percent';

export interface EffectiveGeneralRates {
  base: MethodPercent[];
  bySubject: Map<string, MethodPercent[]>;
}
