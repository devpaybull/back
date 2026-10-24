import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from '../interceptors/response-envelope.interceptor';
import { toPage } from '../types/page';

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

  describe('a page', () => {
    const page = toPage([[{ id: 1 }, { id: 2 }], 137], { page: 2, limit: 20 });

    it('puts the meta beside the data, never inside it', async () => {
      await expect(wrap(page)).resolves.toEqual({
        data: [{ id: 1 }, { id: 2 }],
        meta: { total: 137, page: 2, limit: 20, pages: 7 },
      });
    });

    it('unwraps the items rather than sending the page object itself', async () => {
      const result = await wrap(page);

      expect(result.data).not.toHaveProperty('items');
      expect(JSON.stringify(result)).toBe(
        '{"data":[{"id":1},{"id":2}],"meta":{"total":137,"page":2,"limit":20,"pages":7}}',
      );
    });

    it('survives an empty page', async () => {
      await expect(
        wrap(toPage([[], 0], { page: 1, limit: 20 })),
      ).resolves.toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20, pages: 0 },
      });
    });
  });

  describe('a payload that only looks like a page', () => {
    it('is enveloped whole, meta and all', async () => {
      const lookalike = {
        items: [{ id: 1 }],
        meta: { total: 1, page: 1, limit: 20, pages: 1 },
      };

      await expect(wrap(lookalike)).resolves.toEqual({ data: lookalike });
    });

    it('gets no meta of its own beside the data', async () => {
      const result = await wrap({ items: [{ id: 1 }] });

      expect(result).not.toHaveProperty('meta');
      expect(result).toEqual({ data: { items: [{ id: 1 }] } });
    });
  });

  it('passes a StreamableFile through untouched so a download is not wrapped', async () => {
    const file = new StreamableFile(Buffer.from('a,b\r\n'));

    await expect(wrap(file)).resolves.toBe(file);
  });
});
