import { describe, expect, it } from 'vitest';

import {
  SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1,
  createServerHttpRequestBodyItemBudgetV1,
  readServerHttpRequestBodyUtf8ByteLengthV1,
} from './requestBodyBoundsV1.js';

const EMPTY_ITEMS_BODY = { items: [] } as const;
const EMPTY_ITEMS_BODY_BYTES = readServerHttpRequestBodyUtf8ByteLengthV1(EMPTY_ITEMS_BODY);
/** `"x…x"` costs its own characters plus the two JSON string quotes. */
const QUOTED_STRING_OVERHEAD_BYTES = 2;

function filler(bodyBytes: number): string {
  return 'x'.repeat(bodyBytes - EMPTY_ITEMS_BODY_BYTES - QUOTED_STRING_OVERHEAD_BYTES);
}

describe('server HTTP request body bounds', () => {
  it('measures a body as the transport serializes it, in UTF-8 bytes', () => {
    expect(readServerHttpRequestBodyUtf8ByteLengthV1({ a: 'é' })).toBe(
      readServerHttpRequestBodyUtf8ByteLengthV1({ a: 'a' }) + 1,
    );
    expect(readServerHttpRequestBodyUtf8ByteLengthV1(() => undefined))
      .toBe(Number.POSITIVE_INFINITY);
  });

  it('admits ordered items until the serialized body reaches the transport ceiling', () => {
    const budget = createServerHttpRequestBodyItemBudgetV1(EMPTY_ITEMS_BODY);
    // One byte of headroom is left, which a second item consumes only together
    // with the array separator it also costs.
    const first = filler(SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1 - 1);
    expect(readServerHttpRequestBodyUtf8ByteLengthV1({ items: [first] }))
      .toBe(SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1 - 1);

    expect(budget.tryAdmit(first)).toBe(true);
    expect(budget.tryAdmit(0)).toBe(false);
    expect(readServerHttpRequestBodyUtf8ByteLengthV1({ items: [first, 0] }))
      .toBe(SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1 + 1);
  });

  it('admits a following item that still fits together with its separator', () => {
    const budget = createServerHttpRequestBodyItemBudgetV1(EMPTY_ITEMS_BODY);
    const first = filler(SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1 - 2);

    expect(budget.tryAdmit(first)).toBe(true);
    expect(budget.tryAdmit(0)).toBe(true);
    expect(readServerHttpRequestBodyUtf8ByteLengthV1({ items: [first, 0] }))
      .toBe(SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1);
  });

  it('rejects an unsendable item without consuming the budget it was measured against', () => {
    const budget = createServerHttpRequestBodyItemBudgetV1(EMPTY_ITEMS_BODY);

    expect(budget.tryAdmit('x'.repeat(SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1))).toBe(false);
    expect(budget.tryAdmit(() => undefined)).toBe(false);
    expect(budget.tryAdmit('kept')).toBe(true);
  });

  it('rejects every item when the body itself cannot be sent', () => {
    const budget = createServerHttpRequestBodyItemBudgetV1({
      padding: 'x'.repeat(SERVER_HTTP_REQUEST_MAX_BODY_UTF8_BYTES_V1),
      items: [],
    });

    expect(budget.tryAdmit(0)).toBe(false);
  });
});
