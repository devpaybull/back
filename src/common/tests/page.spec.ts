import { Page, toPage } from '../types/page';

describe('toPage', () => {
  const request = { page: 2, limit: 20 };

  it('carries the rows as items and the total from the same query', () => {
    const page = toPage([[{ id: 1 }, { id: 2 }], 137], request);

    expect(page.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(page.meta.total).toBe(137);
  });

  it('echoes the requested page and limit', () => {
    expect(toPage([[], 0], request).meta).toMatchObject({
      page: 2,
      limit: 20,
    });
  });

  it.each([
    [137, 20, 7],
    [140, 20, 7],
    [141, 20, 8],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [5, 1, 5],
  ])('rounds %i rows of %i up to %i pages', (total, limit, pages) => {
    expect(toPage([[], total], { page: 1, limit }).meta.pages).toBe(pages);
  });

  it('reports no pages at all when there is nothing', () => {
    const page = toPage([[], 0], { page: 1, limit: 20 });

    expect(page.meta.pages).toBe(0);
    expect(page.meta.total).toBe(0);
    expect(page.items).toEqual([]);
  });

  it('builds an instance the interceptor can recognise', () => {
    expect(toPage([[], 0], request)).toBeInstanceOf(Page);
  });
});

describe('Page.map', () => {
  const page = toPage([[1, 2, 3], 3], { page: 1, limit: 20 });

  it('transforms the items', () => {
    expect(page.map((item) => item * 2).items).toEqual([2, 4, 6]);
  });

  it('keeps the meta of the page it came from', () => {
    expect(page.map(String).meta).toBe(page.meta);
  });

  it('stays a page', () => {
    expect(page.map(String)).toBeInstanceOf(Page);
  });
});
