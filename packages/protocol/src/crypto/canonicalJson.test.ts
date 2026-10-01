import { describe, expect, it } from 'vitest';

import { createCanonicalJsonSigningInput } from './canonicalJson.js';

describe('createCanonicalJsonSigningInput', () => {
  it('canonicalizes deep serializable JSON without consuming the call stack', () => {
    let value: unknown = null;
    for (let depth = 0; depth < 1_200; depth += 1) value = { z: [value], a: 1 };
    expect(createCanonicalJsonSigningInput(value)).toBe('{"a":1,"z":['.repeat(1_200) + 'null' + ']}'.repeat(1_200));
  });
  it('always returns canonical string output for accepted JSON', () => {
    expect(createCanonicalJsonSigningInput(null)).toBe('null');
    expect(createCanonicalJsonSigningInput({ z: [true, 1, 'value'], a: { b: null } }))
      .toBe('{"a":{"b":null},"z":[true,1,"value"]}');
  });

  it('preserves canonical numeric-key ordering, prototype-named data and scalar escaping', () => {
    const value = JSON.parse('{"z":"\\ud800","__proto__":{"z":-0,"a":"quote\\\""},"10":10,"2":2}');
    expect(createCanonicalJsonSigningInput(value)).toBe('{"2":2,"10":10,"__proto__":{"a":"quote\\\"","z":0},"z":"\\ud800"}');
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
