import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedExecutablePluginRuntimeRegistry } from '../resolveExecutablePluginRuntimeRegistry';

import { bootstrapPrimaryAgentRuntimesForReadiness } from './readiness';

describe('primary Agent runtime readiness', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a primary runtime factory that never settles instead of blocking readiness forever', async () => {
    vi.useFakeTimers();
    const retirement = new AbortController();
    const registry = {
      agentRuntimesByAgentId: new Map([['acme', {
        agentId: 'acme',
        pluginId: 'com.acme.agent',
        hasPrimaryRuntime: true,
        retirementSignal: retirement.signal,
        createRuntime: () => new Promise<never>(() => undefined),
      }]]),
    } as unknown as ResolvedExecutablePluginRuntimeRegistry;

    const readiness = bootstrapPrimaryAgentRuntimesForReadiness({
      registry,
      pluginIds: ['com.acme.agent'],
    });
    const rejection = expect(readiness).rejects.toThrow(
      "Plugin 'com.acme.agent' primary Agent runtime readiness timed out after 30000ms",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
  });

  it('shares one absolute readiness timeout across multiple primary runtime factories', async () => {
    vi.useFakeTimers();
    const retirement = new AbortController();
    const registry = {
      agentRuntimesByAgentId: new Map([
        ['alpha', {
          agentId: 'alpha',
          pluginId: 'com.acme.alpha',
          hasPrimaryRuntime: true,
          retirementSignal: retirement.signal,
          createRuntime: () => new Promise<void>((resolve) => {
            setTimeout(resolve, 20_000);
          }),
        }],
        ['beta', {
          agentId: 'beta',
          pluginId: 'com.acme.beta',
          hasPrimaryRuntime: true,
          retirementSignal: retirement.signal,
          createRuntime: () => new Promise<never>(() => undefined),
        }],
      ]),
    } as unknown as ResolvedExecutablePluginRuntimeRegistry;

    const readiness = bootstrapPrimaryAgentRuntimesForReadiness({
      registry,
      pluginIds: ['com.acme.alpha', 'com.acme.beta'],
    });
    let failure: unknown = null;
    void readiness.catch((error: unknown) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(failure).toEqual(new Error(
      "Plugin 'com.acme.beta' primary Agent runtime readiness timed out after 30000ms",
    ));
  });
});
