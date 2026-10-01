import { describe, expect, it } from 'vitest';

import {
  decodeExecutionRunProfileResult,
  validateExecutionRunProfileResult,
  buildExecutionRunResultContractPrompt,
  normalizeExecutionRunProfileResultContract,
  decodeExecutionRunResultObservation,
} from './resultContract.js';

describe('execution Run result contract codec', () => {
  it('keeps declared decision reasons through typed and raw observations and rejects undeclared or malformed objects', () => {
    const contract = { kind: 'decision' as const, decisions: ['continue', 'done', 'stuck'] };
    const value = { decision: 'stuck', reason: 'no progress' };
    expect(decodeExecutionRunResultObservation({ encoding: 'typed', value }, contract)).toEqual({ ok: true, value });
    expect(decodeExecutionRunResultObservation({ encoding: 'raw_text', value: JSON.stringify(value) }, contract)).toEqual({ ok: true, value });
    for (const invalid of [{ decision: 'stop' }, { decision: 'done', reason: 1 }, { decision: 'done', extra: true }]) {
      expect(validateExecutionRunProfileResult(invalid, contract)).toMatchObject({ ok: false, reason: 'decision_not_permitted' });
    }
  });
  it('preserves exact raw text while allowing surrounding whitespace around typed JSON', () => {
    expect(decodeExecutionRunProfileResult('  keep exact\n', { kind: 'text' })).toEqual({
      ok: true,
      value: '  keep exact\n',
    });
    expect(decodeExecutionRunProfileResult('  {"ok":true}\n', {
      kind: 'json', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    })).toEqual({ ok: true, value: { ok: true } });
  });

  it('reports typed failures and RFC 6901 paths through the canonical schema compiler', () => {
    const contract = {
      kind: 'json' as const,
      schema: {
        type: 'object' as const,
        properties: { 'a/b~c': { type: 'array' as const, items: { type: 'number' as const } } },
        required: ['a/b~c'],
        additionalProperties: false,
      },
    };
    expect(decodeExecutionRunProfileResult('broken', contract)).toEqual({ ok: false, reason: 'not_json' });
    expect(validateExecutionRunProfileResult({ 'a/b~c': ['wrong'] }, contract)).toMatchObject({
      ok: false, reason: 'schema_mismatch',
      issues: [{ pointer: '/a~1b~0c/0', message: expect.any(String) }],
    });
    expect(validateExecutionRunProfileResult({}, contract)).toMatchObject({
      ok: false, reason: 'schema_mismatch',
      issues: [{ pointer: '/a~1b~0c', message: expect.any(String) }],
    });
    expect(validateExecutionRunProfileResult({ 'a/b~c': [], extra: true }, contract)).toMatchObject({
      ok: false, reason: 'schema_mismatch',
      issues: [{ pointer: '/extra', message: expect.any(String) }],
    });
    expect(validateExecutionRunProfileResult(42, { kind: 'text' })).toEqual({ ok: false, reason: 'not_text' });
    expect(validateExecutionRunProfileResult(NaN, contract)).toEqual({ ok: false, reason: 'not_strict_json' });
    expect(validateExecutionRunProfileResult('stop', { kind: 'decision', decisions: ['continue', 'done'] })).toEqual({
      ok: false, reason: 'decision_not_permitted',
    });
    expect(validateExecutionRunProfileResult({}, { kind: 'json', schema: { type: 'object', required: ['x', 'x'] } })).toEqual({
      ok: false, reason: 'schema_unavailable',
    });
  });

  it.each(['value', { ok: true }, [1, 'two'], true, 3, null])('decodes raw JSON once and validates typed JSON %j', (value) => {
    const contract = { kind: 'json' as const, schema: {} };
    expect(decodeExecutionRunResultObservation({ encoding: 'raw_text', value: JSON.stringify(value) }, contract)).toEqual({ ok: true, value });
    expect(decodeExecutionRunResultObservation({ encoding: 'typed', value }, contract)).toEqual({ ok: true, value });
  });

  it('accepts empty text and constructs instructions from the same normalized contract', () => {
    expect(decodeExecutionRunProfileResult('', { kind: 'text' })).toEqual({ ok: true, value: '' });
    const contract = normalizeExecutionRunProfileResultContract({
      kind: 'json', schema: { type: 'object', properties: { done: { type: 'boolean' } }, required: ['done'] },
    });
    expect(buildExecutionRunResultContractPrompt(contract)?.split('\n').at(-1)).toBe(JSON.stringify(contract?.kind === 'json' ? contract.schema : null));
    const decision = { kind: 'decision' as const, decisions: ['continue', 'done'] };
    expect(buildExecutionRunResultContractPrompt(decision)?.split('\n').at(-1)).toBe(JSON.stringify(decision.decisions));
    expect(decodeExecutionRunProfileResult('"done"', decision)).toEqual({ ok: true, value: 'done' });
    expect(buildExecutionRunResultContractPrompt({ kind: 'text' })).toBeNull();
  });
});
