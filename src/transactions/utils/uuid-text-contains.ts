import { FindOperator, Raw } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';

const quotedPath = (path: string): string =>
  path
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');

export function uuidTextContains(piece: string): FindOperator<string> {
  return Raw((column) => `${quotedPath(column)}::text ILIKE :uuidPiece`, {
    uuidPiece: `%${escapeLikePattern(piece.toLowerCase())}%`,
  });
}
