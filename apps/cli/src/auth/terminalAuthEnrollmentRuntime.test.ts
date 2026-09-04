import { describe, expect, it, vi } from 'vitest';
import { HomeConnectionDescriptorV1Schema } from '@happier-dev/protocol';

import { acquireTerminalAuthEnrollmentRuntime } from './terminalAuthEnrollmentRuntime';

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
