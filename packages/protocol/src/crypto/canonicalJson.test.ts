import { describe, expect, it } from 'vitest';

import { createCanonicalJsonSigningInput } from './canonicalJson.js';

describe('createCanonicalJsonSigningInput', () => {
  it('always returns canonical string output for accepted JSON', () => {
    expect(createCanonicalJsonSigningInput(null)).toBe('null');
    expect(createCanonicalJsonSigningInput({ z: [true, 1, 'value'], a: { b: null } }))
      .toBe('{"a":{"b":null},"z":[true,1,"value"]}');
  });

  it.each([
    undefined,
    () => undefined,
    Symbol('invalid'),
    1n,
    { invalid: undefined },
    { invalid: () => undefined },
    [undefined],
  ])('fails explicitly for invalid runtime input %#', (value) => {
    expect(() => createCanonicalJsonSigningInput(value as never)).toThrow();
  });
});
