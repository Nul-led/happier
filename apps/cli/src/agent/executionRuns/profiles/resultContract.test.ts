import { describe, expect, it } from 'vitest';

import { decodeExecutionRunProfileResult } from './resultContract';

describe('execution Run result contract codec', () => {
  it('preserves exact raw text while allowing surrounding whitespace around typed JSON', () => {
    expect(decodeExecutionRunProfileResult('  keep exact\n', { kind: 'text' })).toEqual({
      ok: true,
      value: '  keep exact\n',
    });
    expect(decodeExecutionRunProfileResult('  {"ok":true}\n', {
      kind: 'json', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    })).toEqual({ ok: true, value: { ok: true } });
  });
});
