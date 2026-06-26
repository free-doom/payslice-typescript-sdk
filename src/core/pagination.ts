/**
 * Cursor pagination as an async iterator. Each page is fetched lazily as the
 * consumer advances, so `for await (const item of ...)` walks the entire
 * result set without the caller ever touching a cursor.
 */

export interface CursorPage<T> {
  items: T[];
  next_cursor?: string | null;
}

export class Paginator<T> implements AsyncIterable<T> {
  constructor(
    private readonly fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
  ) {}

  /** Iterate every item across all pages. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let cursor: string | undefined;
    do {
      const page = await this.fetchPage(cursor);
      for (const item of page.items) {
        yield item;
      }
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }

  /** Iterate page by page, exposing each raw page (and its cursor). */
  async *pages(): AsyncGenerator<CursorPage<T>> {
    let cursor: string | undefined;
    do {
      const page = await this.fetchPage(cursor);
      yield page;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }

  /** Eagerly collect every item into an array. Use with care on large sets. */
  async toArray(): Promise<T[]> {
    const all: T[] = [];
    for await (const item of this) all.push(item);
    return all;
  }
}
