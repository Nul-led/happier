/**
 * Map over entries with a bounded number of in-flight operations, preserving input order.
 *
 * The bound is the point: `Promise.all` over a page issues one request per row at once, which is
 * a burst against the Home for a 200-row page. Consumers pass the ceiling that matches the
 * resource they are protecting.
 */
export async function mapWithConcurrency<TInput, TOutput>(
  entries: readonly TInput[],
  concurrency: number,
  mapper: (entry: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const output = new Array<TOutput>(entries.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= entries.length) return;
      output[index] = await mapper(entries[index] as TInput, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, () => worker()));
  return output;
}
