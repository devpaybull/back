import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

describe('ResponseEnvelopeInterceptor', () => {
  const wrap = <T>(value: T) => {
    const interceptor = new ResponseEnvelopeInterceptor<T>();
    const next: CallHandler<T> = { handle: () => of(value) };

    return lastValueFrom(interceptor.intercept({} as ExecutionContext, next));
  };

  it('wraps an object', async () => {
    await expect(wrap({ id: 1 })).resolves.toEqual({ data: { id: 1 } });
  });

  it('wraps an array without flattening it', async () => {
    await expect(wrap([1, 2])).resolves.toEqual({ data: [1, 2] });
  });

  it('wraps a primitive', async () => {
    await expect(wrap('ok')).resolves.toEqual({ data: 'ok' });
  });

  it('keeps a falsy value instead of nulling it', async () => {
    await expect(wrap(0)).resolves.toEqual({ data: 0 });
    await expect(wrap(false)).resolves.toEqual({ data: false });
    await expect(wrap('')).resolves.toEqual({ data: '' });
  });

  it('normalises undefined to null so the shape survives serialisation', async () => {
    const result = await wrap(undefined);

    expect(result).toEqual({ data: null });
    expect(JSON.stringify(result)).toBe('{"data":null}');
  });

  it('passes null through', async () => {
    await expect(wrap(null)).resolves.toEqual({ data: null });
  });

  it('does not double-wrap a payload that already has a data key', async () => {
    await expect(wrap({ data: 1 })).resolves.toEqual({ data: { data: 1 } });
  });
});
