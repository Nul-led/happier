const UTF8_ENCODER = new TextEncoder();

/**
 * The API server's HTTP request-body transport ceiling. The Fastify instance
 * enforces exactly this value for every route that does not narrow it further,
 * so a request producer that has to split its work across several complete
 * requests partitions against this same owner instead of restating a
 * feature-local ceiling.
 */
export const SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1 = 100 * 1024 * 1024;

/**
 * UTF-8 length of one JSON request body exactly as the HTTP transport
 * serializes it. A body the transport cannot serialize has no finite length.
 */
export function readServerHttpRequestBodyUtf8ByteLengthV1(body: unknown): number {
  const serialized = JSON.stringify(body);
  if (serialized === undefined) return Number.POSITIVE_INFINITY;
  return UTF8_ENCODER.encode(serialized).byteLength;
}

/**
 * Ordered admission budget for one request body whose payload is a single JSON
 * array of items. It answers the only question a partitioning producer has —
 * "does one more ordered item still fit this complete body?" — so producers
 * never carry their own ceiling or size estimator.
 */
export type ServerHttpRequestBodyItemBudgetV1 = Readonly<{
  /**
   * Admits one more ordered item when the serialized body would still fit the
   * transport ceiling. A rejected item is not consumed, so the caller may carry
   * it into the next request; a first item that is rejected cannot be sent at
   * all.
   */
  tryAdmit(item: unknown): boolean;
}>;

/**
 * Opens a budget for the exact request body the producer will send, with its
 * ordered item array still empty. Measurement stays linear in the item count:
 * a JSON array serializes as its elements concatenated with one separator
 * between them, so each admitted item costs its own serialized length plus one
 * separator byte after the first.
 */
export function createServerHttpRequestBodyItemBudgetV1(
  bodyWithoutItems: unknown,
): ServerHttpRequestBodyItemBudgetV1 {
  let usedBytes = readServerHttpRequestBodyUtf8ByteLengthV1(bodyWithoutItems);
  let admittedItems = 0;
  return Object.freeze({
    tryAdmit(item: unknown): boolean {
      const nextBytes = usedBytes
        + readServerHttpRequestBodyUtf8ByteLengthV1(item)
        + (admittedItems === 0 ? 0 : 1);
      if (
        !Number.isFinite(nextBytes)
        || nextBytes > SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1
      ) return false;
      usedBytes = nextBytes;
      admittedItems += 1;
      return true;
    },
  });
}
