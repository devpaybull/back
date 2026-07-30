import { ApiProperty } from '@nestjs/swagger';

export class PageMeta {
  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  pages: number;
}

export interface PageRequest {
  page: number;
  limit: number;
}

export class Page<T> {
  constructor(
    readonly items: T[],
    readonly meta: PageMeta,
  ) {}

  map<U>(toItem: (item: T) => U): Page<U> {
    return new Page(this.items.map(toItem), this.meta);
  }
}

export const toPage = <T>(
  [items, total]: [T[], number],
  request: PageRequest,
): Page<T> =>
  new Page(items, {
    total,
    page: request.page,
    limit: request.limit,
    pages: Math.ceil(total / request.limit),
  });
