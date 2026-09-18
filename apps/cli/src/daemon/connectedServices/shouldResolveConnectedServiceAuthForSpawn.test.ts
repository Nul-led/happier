import { describe, expect, it } from 'vitest';

import type { SpawnSessionOptions } from '@/rpc/handlers/registerSessionHandlers';

import { shouldResolveConnectedServiceAuthForSpawn } from './shouldResolveConnectedServiceAuthForSpawn';

describe('shouldResolveConnectedServiceAuthForSpawn', () => {
  it.each([null, {}])('keeps malformed present intent on the admission path (%j)', (connectedServices) => {
    expect(shouldResolveConnectedServiceAuthForSpawn({ connectedServices })).toBe(true);
  });

  it('does not materialize an explicit empty current selection', () => {
    expect(shouldResolveConnectedServiceAuthForSpawn({
      connectedServices: { v: 2, bindingsByServiceId: {} },
    })).toBe(false);
  });

  it('returns false when no connectedServices payload is provided', () => {
    const options: SpawnSessionOptions = { directory: '.', environmentVariables: {} };
    expect(shouldResolveConnectedServiceAuthForSpawn(options)).toBe(false);
  });

  it('ignores legacy token-shaped payload noise and still resolves connected-services auth', () => {
    const options = {
      directory: '.',
      token: 'legacy-spawn-token',
      connectedServices: { v: 1, bindingsByServiceId: { anthropic: { source: 'connected', profileId: 'work' } } },
      environmentVariables: {},
    } as any as SpawnSessionOptions;
    expect(shouldResolveConnectedServiceAuthForSpawn(options)).toBe(true);
  });

  it('returns false when all bindings are native', () => {
    const options: SpawnSessionOptions = {
      directory: '.',
      connectedServices: { v: 1, bindingsByServiceId: { anthropic: { source: 'native' } } },
      environmentVariables: {},
    };
    expect(shouldResolveConnectedServiceAuthForSpawn(options)).toBe(false);
  });

  it('returns true when at least one binding requests connected-services auth', () => {
    const options: SpawnSessionOptions = {
      directory: '.',
      connectedServices: { v: 1, bindingsByServiceId: { anthropic: { source: 'connected', profileId: 'work' } } },
      environmentVariables: {},
    };
    expect(shouldResolveConnectedServiceAuthForSpawn(options)).toBe(true);
  });
});
