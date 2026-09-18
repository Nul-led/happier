import { describe, expect, it } from 'vitest';

import { SecretReferenceOverlayV1Schema } from './secretReferenceOverlayV1.js';

describe('SecretReferenceOverlayV1Schema', () => {
  it('accepts all declared launch bindings without inventing a binding-count limit', () => {
    const bindings = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [
      `SECRET_${index}`,
      { ref: `happier:shared-secret:v1:resource-${index}`, revision: index + 1 },
    ]));
    expect(Object.keys(SecretReferenceOverlayV1Schema.parse({ v: 1, bindings }).bindings))
      .toHaveLength(65);
  });

  it('requires the exact revision for shared resources and forbids it for personal references', () => {
    expect(SecretReferenceOverlayV1Schema.safeParse({
      v: 1,
      bindings: { API_KEY: { ref: 'happier:shared-secret:v1:shared' } },
    }).success).toBe(false);
    expect(SecretReferenceOverlayV1Schema.safeParse({
      v: 1,
      bindings: { API_KEY: { ref: 'happier:shared-secret:v1:shared', revision: 2 } },
    }).success).toBe(true);
    expect(SecretReferenceOverlayV1Schema.safeParse({
      v: 1,
      bindings: { API_KEY: { ref: 'personal-secret', revision: 2 } },
    }).success).toBe(false);
    expect(SecretReferenceOverlayV1Schema.safeParse({
      v: 1,
      bindings: { API_KEY: { ref: 'personal-secret' } },
    }).success).toBe(true);
  });

  it('stays value-free and rejects an empty overlay', () => {
    expect(SecretReferenceOverlayV1Schema.safeParse({
      v: 1,
      bindings: { API_KEY: { ref: 'happier:shared-secret:v1:shared', revision: 2, value: 'secret' } },
    }).success).toBe(false);
    expect(SecretReferenceOverlayV1Schema.safeParse({ v: 1, bindings: {} }).success).toBe(false);
  });
});
