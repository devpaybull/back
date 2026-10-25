import { toFiat } from '../../common/utils/to-fiat';
import { SubjectMethodRates } from '../../transactions/types/rate-set';
import { RateSetDto } from '../dto/rate-set.dto';

export function toSubjectMethodRates(dto: RateSetDto): SubjectMethodRates[] {
  return dto.methods.map((method) => ({
    method: method.method,
    general: method.general ?? null,
    bands: (method.bands ?? []).map((band) => ({
      ...band,
      fromAmount: toFiat(band.fromAmount),
      toAmount: toFiat(band.toAmount),
    })),
    banks: method.banks ?? [],
  }));
}
