import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeConnectionDescriptorV1Schema } from '@happier-dev/protocol';
import { createNodeIrohHomeTunnelSession } from '@happier-dev/iroh-native/node';
import { join } from 'node:path';

import { createEnvKeyScope } from '@/testkit/env/envScope';

import { acquireTerminalAuthEnrollmentRuntime } from './terminalAuthEnrollmentRuntime';

type NodeIrohNativeModule = NonNullable<Parameters<typeof createNodeIrohHomeTunnelSession>[0]['native']>;

const DESCRIPTOR = HomeConnectionDescriptorV1Schema.parse({
  v: 1,
  homeServerIdentityId: 'srv_home_runtime',
  canonicalServerUrl: 'https://home.example.test',
  revision: 1,
  endpoints: [
    { kind: 'https', url: 'https://home.example.test' },
    { kind: 'iroh', endpointId: 'a'.repeat(64) },
  ],
});

describe('acquireTerminalAuthEnrollmentRuntime', () => {
  const envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_HOME_CARRIER_POLICY'] as const);

  afterEach(() => envScope.restore());

  it('uses the standard Home application endpoint without creating an Iroh session when Standard only is configured', async () => {
    envScope.patch({ HAPPIER_HOME_CARRIER_POLICY: 'standard_only' });
    const createSession = vi.fn();
    const acquired = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, {
      createSession,
      classifyFailure: () => ({ fallbackAllowed: false }),
    });

    expect(acquired).toMatchObject({ ok: true, runtime: { carrier: 'https', runtimeOrigin: 'https://home.example.test' } });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('uses fresh Account-client identities for independent terminal auth acquisitions', async () => {
    const homeDir = join(process.cwd(), '.tmp-terminal-auth-identity');
    envScope.patch({ HAPPIER_HOME_DIR: homeDir });
    // The native addon is the OS boundary; keep the real session owner underneath.
    // Like the native manager, keyed endpoints share identity; keyless ones do not.
    const origins = new Map<string, string>();
    const activeOrigins = new Set<string>();
    let nextEndpoint = 0;
    const unusedNativeOperation = async (): Promise<never> => { throw new Error('Unexpected native operation'); };
    const native = {
      getAvailability: (): never => { throw new Error('Unexpected availability read'); },
      startHomeAcceptor: unusedNativeOperation, stopHomeAcceptor: unusedNativeOperation,
      getEndpointStatus: unusedNativeOperation, getTunnelStatus: unusedNativeOperation,
      startMachineAcceptor: unusedNativeOperation, stopMachineAcceptor: unusedNativeOperation,
      getMachineAcceptorStatus: unusedNativeOperation, startMachineTunnel: unusedNativeOperation,
      startMachineHttpTunnel: unusedNativeOperation, stopMachineTunnel: unusedNativeOperation,
      getMachineTunnelStatus: unusedNativeOperation,
      createEndpoint: async ({ keyPath }: Readonly<{ keyPath?: string }>) => {
        const endpointHandle = keyPath ?? `helper-${++nextEndpoint}`;
        const runtimeOrigin = origins.get(endpointHandle) ?? `http://127.0.0.1:${48123 + origins.size}`;
        origins.set(endpointHandle, runtimeOrigin);
        activeOrigins.add(runtimeOrigin);
        return { endpointHandle, endpointId: 'b'.repeat(64), relayPolicy: 'automatic' as const,
          relayMode: 'custom' as const, capProfile: 'account_client', relayUrls: [] };
      },
      ensureHomeTunnel: async ({ endpointHandle }: Readonly<{ endpointHandle: string }>) => ({
        tunnelId: `tunnel-${endpointHandle}`, endpointHandle,
        homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
        homeEndpointId: 'a'.repeat(64), runtimeOrigin: origins.get(endpointHandle)!, observedPath: 'relay' as const,
        carrier: 'iroh' as const, startedAtMs: 1,
      }),
      releaseHomeTunnel: async () => undefined,
      shutdownEndpoint: async ({ endpointHandle }: Readonly<{ endpointHandle: string }>) => {
        activeOrigins.delete(origins.get(endpointHandle)!);
      },
    } satisfies NodeIrohNativeModule;
    const createSession = vi.fn(async (input: Readonly<{ keylessEndpoint: 'account_client' }>) =>
      await createNodeIrohHomeTunnelSession({ ...input, native }),
    );
    const deps = {
      createSession,
      classifyFailure: () => ({ fallbackAllowed: false }),
    };

    const first = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, deps);
    if (!first.ok) throw new Error('expected first acquired runtime');
    const second = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, deps);
    if (!second.ok) throw new Error('expected second acquired runtime');
    try {
      expect(first.runtime.runtimeOrigin).not.toBe(second.runtime.runtimeOrigin);
      await first.close();
      expect(activeOrigins.has(second.runtime.runtimeOrigin)).toBe(true);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('projects an Iroh-first lease into an explicit authenticated enrollment runtime', async () => {
    const release = vi.fn(async () => {});
    const shutdown = vi.fn(async () => {});
    const acquired = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, {
      createSession: async () => ({
        ensureHomeTunnel: async () => ({
          homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
          endpointId: 'a'.repeat(64),
          runtimeOrigin: 'http://127.0.0.1:48123',
          observedPath: 'relay' as const,
          status: 'ready' as const,
          release,
        }),
        shutdown,
      }),
      classifyFailure: () => ({ fallbackAllowed: false }),
    });

    expect(acquired.ok && acquired.runtime).toEqual({
      runtimeOrigin: 'http://127.0.0.1:48123',
      carrier: 'iroh',
      authenticatedCredentialDestination: { kind: 'iroh', endpointId: 'a'.repeat(64) },
    });
    if (!acquired.ok) throw new Error('expected acquired runtime');
    await acquired.close();
    expect(release).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('threads caller cancellation into the native Home tunnel acquisition boundary', async () => {
    const controller = new AbortController();
    const observedSignals: Array<AbortSignal | undefined> = [];
    const acquired = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, {
      createSession: async () => ({
        ensureHomeTunnel: async (input) => {
          observedSignals.push(input.signal);
          return {
            homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
            endpointId: 'a'.repeat(64),
            runtimeOrigin: 'http://127.0.0.1:48123',
            observedPath: 'relay' as const,
            status: 'ready' as const,
            release: async () => undefined,
          };
        },
        shutdown: async () => undefined,
      }),
      classifyFailure: () => ({ fallbackAllowed: false }),
    }, controller.signal);

    expect(acquired.ok).toBe(true);
    expect(observedSignals).toEqual([controller.signal]);
    if (acquired.ok) await acquired.close();
  });

  it('always shuts down the native session when lease release fails', async () => {
    const releaseFailure = new Error('release failed');
    const release = vi.fn(async () => { throw releaseFailure; });
    const shutdown = vi.fn(async () => {});
    const acquired = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, {
      createSession: async () => ({
        ensureHomeTunnel: async () => ({
          homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
          endpointId: 'a'.repeat(64),
          runtimeOrigin: 'http://127.0.0.1:48123',
          observedPath: 'relay' as const,
          status: 'ready' as const,
          release,
        }),
        shutdown,
      }),
      classifyFailure: () => ({ fallbackAllowed: false }),
    });

    if (!acquired.ok) throw new Error('expected acquired runtime');
    await expect(acquired.close()).rejects.toBe(releaseFailure);
    expect(release).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('reports both lease release and session shutdown failures after settling both', async () => {
    const releaseFailure = new Error('release failed');
    const shutdownFailure = new Error('shutdown failed');
    const acquired = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, {
      createSession: async () => ({
        ensureHomeTunnel: async () => ({
          homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
          endpointId: 'a'.repeat(64),
          runtimeOrigin: 'http://127.0.0.1:48123',
          observedPath: 'relay' as const,
          status: 'ready' as const,
          release: async () => { throw releaseFailure; },
        }),
        shutdown: async () => { throw shutdownFailure; },
      }),
      classifyFailure: () => ({ fallbackAllowed: false }),
    });

    if (!acquired.ok) throw new Error('expected acquired runtime');
    const failure = await acquired.close().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([releaseFailure, shutdownFailure]);
  });

  it('uses exact descriptor HTTPS only when policy authorizes fallback', async () => {
    const shutdown = vi.fn(async () => {});
    const acquired = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, {
      createSession: async () => ({
        ensureHomeTunnel: async () => { throw new Error('unavailable'); },
        shutdown,
      }),
      classifyFailure: () => ({ fallbackAllowed: true }),
    });

    expect(acquired.ok && acquired.runtime).toEqual({
      runtimeOrigin: 'https://home.example.test',
      carrier: 'https',
      authenticatedCredentialDestination: {
        kind: 'https',
        applicationUrl: 'https://home.example.test',
      },
    });
    if (!acquired.ok) throw new Error('expected fallback runtime');
    await acquired.close();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('returns fail-closed and shuts down the native session when policy refuses fallback', async () => {
    const shutdown = vi.fn(async () => {});
    const acquired = await acquireTerminalAuthEnrollmentRuntime(DESCRIPTOR, {
      createSession: async () => ({
        ensureHomeTunnel: async () => { throw new Error('identity mismatch'); },
        shutdown,
      }),
      classifyFailure: () => ({ fallbackAllowed: false }),
    });

    expect(acquired).toMatchObject({ ok: false, reason: 'fail_closed' });
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
