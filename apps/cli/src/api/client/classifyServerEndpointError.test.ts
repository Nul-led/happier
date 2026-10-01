import { describe, expect, it } from 'vitest';

import { classifyServerEndpointError, isProvenPreDispatchConnectionFailure, readNormalizedConnectionErrorCode } from './classifyServerEndpointError';

describe('classifyServerEndpointError', () => {
  it('classifies an unreachable host as retryable network failure, including a nested cause', () => {
    const error = Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' });
    expect(classifyServerEndpointError(error)).toMatchObject({ kind: 'network', retryable: true });
    expect(isProvenPreDispatchConnectionFailure({ cause: error })).toBe(true);
  });

  it('does not treat a reset connection as proof that a mutation was never dispatched', () => {
    expect(isProvenPreDispatchConnectionFailure({ code: 'ECONNRESET' })).toBe(false);
  });

  it('finds a nested code when a wrapper has only whitespace at its top level', () => {
    const error = { code: ' ', cause: { code: ' ehostunreach ' } };
    expect(readNormalizedConnectionErrorCode(error)).toBe('EHOSTUNREACH');
  });
});
