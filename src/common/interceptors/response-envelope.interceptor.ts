import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Page, PageMeta } from '../types/page';

export interface ResponseEnvelope<T> {
  data: T;
}

export interface PagedResponseEnvelope<T> extends ResponseEnvelope<T[]> {
  meta: PageMeta;
}

export type EnvelopedResponse<T> =
  ResponseEnvelope<T> | PagedResponseEnvelope<unknown>;

const envelope = <T>(payload: T): EnvelopedResponse<T> =>
  payload instanceof StreamableFile
    ? (payload as never)
    : payload instanceof Page
      ? { data: payload.items, meta: payload.meta }
      : { data: payload ?? null };

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  EnvelopedResponse<T>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<EnvelopedResponse<T>> {
    return next.handle().pipe(map(envelope));
  }
}
