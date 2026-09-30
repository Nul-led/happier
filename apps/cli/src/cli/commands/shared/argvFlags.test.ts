import { describe, expect, it } from 'vitest';

import { hasFlag, hasFlagValue, readRawFlagValue, readFlagValue, readCommandPositionals, readIntFlagValue } from './argvFlags';

describe('readCommandPositionals', () => {
  it('excludes flags and their declared values from positional arguments', () => {
    expect(readCommandPositionals(
      ['wait', '--timeout', '15', '--json', 'session-id'],
      { startIndex: 1, valueFlags: ['--timeout'] },
    )).toEqual(['session-id']);
  });

  it('allows flag-looking positional values after the option terminator', () => {
    expect(readCommandPositionals(['send', 'session-id', '--', '--help'], { startIndex: 1 }))
      .toEqual(['session-id', '--help']);
  });
});

describe('readIntFlagValue', () => {
  it('returns null when the flag is absent and accepts zero when the caller allows it', () => {
    expect(readIntFlagValue(['command'], '--limit', { min: 1 })).toBeNull();
    expect(readIntFlagValue(['command', '--cursor', '0'], '--cursor', { min: 0 })).toBe(0);
  });

  it('rejects integers outside the JavaScript safe-integer range', () => {
    expect(() => readIntFlagValue(['command', '--limit', '9007199254740992'], '--limit'))
      .toThrow(expect.objectContaining({ code: 'invalid_arguments' }));
  });

  it.each([
    ['a missing value', ['command', '--limit']],
    ['a partial integer', ['command', '--limit', '10oops']],
    ['a value below the caller bound', ['command', '--limit', '0']],
    ['a value above the caller bound', ['command', '--limit', '201']],
  ])('rejects %s', (_label, argv) => {
    expect(() => readIntFlagValue(argv, '--limit', { min: 1, max: 200 }))
      .toThrow(expect.objectContaining({ code: 'invalid_arguments' }));
  });
});

describe('option terminator', () => {
  it('keeps the standalone terminator out of a preceding option value', () => {
    const argv = ['send', 'session-id', '--model', '--', '--json'];
    expect(readCommandPositionals(argv, { startIndex: 1, valueFlags: ['--model'] }))
      .toEqual(['session-id', '--json']);
    expect(readFlagValue(argv, '--model')).toBeNull();
    expect(hasFlag(argv, '--json')).toBe(false);
  });

  it('recognizes flags only before the positional-only boundary', () => {
    const argv = ['send', '--local-id', ' chosen-id ', 'session-id', '--', '--local-id', '--timeout', 'oops'];
    expect(readFlagValue(argv, '--local-id')).toBe('chosen-id');
    expect(hasFlag(argv, '--timeout')).toBe(false);
    expect(readIntFlagValue(argv, '--timeout')).toBeNull();
    expect(readFlagValue(['send', 'session-id', '--', '--model', 'gpt-4o'], '--model')).toBeNull();
  });
});

describe('opaque option values', () => {
  const optionFlags = ['--local-id', '--json', '--model'];
  it.each(['-claim-1', '--claim-1', ' ID '])('preserves separate opaque value %j', (value) => {
    expect(readRawFlagValue(['--local-id', value], '--local-id', { optionFlags })).toBe(value);
  });
  it.each(['--json', '--model=x', '--'])('requires inline syntax for option token %j', (value) => {
    expect(readRawFlagValue(['--local-id', value], '--local-id', { optionFlags })).toBeNull();
    const argv = [`--local-id=${value}`];
    expect(hasFlagValue(argv, '--local-id')).toBe(true);
    expect(readRawFlagValue(argv, '--local-id', { optionFlags })).toBe(value);
    expect(hasFlag(argv, '--json')).toBe(false);
  });
});
