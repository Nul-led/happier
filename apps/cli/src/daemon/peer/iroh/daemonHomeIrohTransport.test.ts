import { describe, expect, it, vi } from 'vitest';
import { IrohError } from '@happier-dev/iroh-native';

import {
  applyDaemonHomeDescriptorRefresh,
  prepareDaemonHomeIrohTransport,
} from './daemonHomeIrohTransport';

const descriptor = {
  v: 1 as const,
  homeServerIdentityId: 'srv_home_daemon',
  canonicalServerUrl: 'https://home.example.test',
  revision: 4,
  endpoints: [{ kind: 'iroh' as const, endpointId: 'c'.repeat(64) }],
};

describe('prepareDaemonHomeIrohTransport', () => {
  it('publishes an identity-verified pre-auth lease and authenticates it without reacquiring', async () => {
    const releaseNative = vi.fn(async () => undefined);
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn(async () => ({
        runtimeOrigin: 'http://127.0.0.1:48123', observedPath: 'direct' as const, release: releaseNative,
      })),
    };
    const publish = vi.fn(() => vi.fn());
    const identityProbe = vi.fn(async () => ({ status: 'ready' as const }));
    const probe = vi.fn(async () => ({ status: 'ready' as const }));

    const result = await prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl, homeConnectionDescriptor: descriptor } as never,
      token: undefined as never,
      identityProbe,
      probe,
      publishRuntimeOrigin: publish,
    });

    expect(identityProbe).toHaveBeenCalledWith({
      serverUrl: 'http://127.0.0.1:48123',
      expectedServerIdentityId: descriptor.homeServerIdentityId,
    });
    expect(publish).toHaveBeenCalledWith('http://127.0.0.1:48123', 'iroh');
    expect(probe).not.toHaveBeenCalled();

    await expect(result.verifyAuthenticated('fresh-token')).resolves.toEqual({ status: 'ready' });
    expect(probe).toHaveBeenCalledWith({
      serverUrl: 'http://127.0.0.1:48123',
      token: 'fresh-token',
      expectedServerIdentityId: descriptor.homeServerIdentityId,
    });
    expect(runtime.ensureHomeTunnel).toHaveBeenCalledOnce();
  });

  it('publishes only an authenticated and identity-matched Iroh runtime origin', async () => {
    const releaseNative = vi.fn(async () => undefined);
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn(async () => ({
        runtimeOrigin: 'http://127.0.0.1:48123', observedPath: 'direct' as const, release: releaseNative,
      })),
    };
    const publish = vi.fn(() => vi.fn());
    const probe = vi.fn(async () => ({ status: 'ready' as const }));

    const result = await prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl, homeConnectionDescriptor: descriptor } as never,
      token: 'account-token',
      readProfile: async () => ({
        serverUrl: descriptor.canonicalServerUrl,
        homeConnectionDescriptor: descriptor,
      }) as never,
      probe,
      publishRuntimeOrigin: publish,
    });

    expect(probe).toHaveBeenCalledWith({
      serverUrl: 'http://127.0.0.1:48123', token: 'account-token',
      expectedServerIdentityId: 'srv_home_daemon',
    });
    expect(publish).toHaveBeenCalledWith('http://127.0.0.1:48123', 'iroh');
    expect(result).toMatchObject({ carrier: 'iroh', observedPath: 'direct' });
    await expect(result.reacquire()).resolves.toEqual({ status: 'ready' });
    expect(runtime.ensureHomeTunnel).toHaveBeenCalledTimes(2);
    expect(releaseNative).toHaveBeenCalledTimes(1);
    await result.release();
    expect(releaseNative).toHaveBeenCalledTimes(2);
  });

  it('fails closed when authenticated verification rejects the Home identity', async () => {
    const release = vi.fn(async () => undefined);
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn(async () => ({
        runtimeOrigin: 'http://127.0.0.1:48123', observedPath: 'unknown' as const, release,
      })),
    };

    await expect(prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl, homeConnectionDescriptor: descriptor } as never,
      token: 'account-token',
      probe: async () => ({ status: 'auth_failed', statusCode: 401, errorMessage: 'denied' }),
      publishRuntimeOrigin: vi.fn(),
    })).rejects.toThrow(/verification failed/i);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('uses the independently reachable standard origin only for carrier availability failures', async () => {
    const descriptorWithHttpsFallback = {
      ...descriptor,
      endpoints: [
        ...descriptor.endpoints,
        { kind: 'https' as const, url: 'https://public-home.example.test' },
      ],
    };
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn(async () => {
        throw new IrohError('transport_timeout', 'timed out');
      }),
    };
    const probe = vi.fn(async ({ serverUrl }: { serverUrl: string }) => (
      serverUrl === 'https://public-home.example.test'
        ? { status: 'ready' as const }
        : { status: 'server_unreachable' as const, errorMessage: 'offline' }
    ));
    const publish = vi.fn(() => vi.fn());

    await expect(prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: {
        serverUrl: descriptor.canonicalServerUrl,
        localServerUrl: 'http://127.0.0.1:3005',
        homeConnectionDescriptor: descriptorWithHttpsFallback,
      } as never,
      token: 'account-token',
      probe: probe as never,
      publishRuntimeOrigin: publish,
    })).resolves.toMatchObject({ carrier: 'standard' });

    expect(publish).toHaveBeenCalledWith('https://public-home.example.test', 'https');
    expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({
      serverUrl: 'https://public-home.example.test',
    }));

    runtime.ensureHomeTunnel.mockRejectedValueOnce(new IrohError('relay_auth_failed', 'relay denied'));
    await expect(prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl, homeConnectionDescriptor: descriptor } as never,
      token: 'account-token',
      readProfile: async () => ({
        serverUrl: descriptor.canonicalServerUrl,
        homeConnectionDescriptor: descriptor,
      }) as never,
      probe: probe as never,
      publishRuntimeOrigin: vi.fn(),
    })).rejects.toMatchObject({ code: 'relay_auth_failed' });

    runtime.ensureHomeTunnel.mockRejectedValueOnce(new IrohError('transport_timeout', 'timed out'));
    await expect(prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: {
        serverUrl: descriptor.canonicalServerUrl,
        localServerUrl: 'http://127.0.0.1:3005',
        homeConnectionDescriptor: descriptor,
      } as never,
      token: 'account-token',
      probe: probe as never,
      publishRuntimeOrigin: vi.fn(),
    })).rejects.toMatchObject({ code: 'transport_timeout' });
  });

  it('never authenticates canonical or loopback origins when required Iroh is unavailable', async () => {
    const probe = vi.fn(async () => ({ status: 'ready' as const }));

    await expect(prepareDaemonHomeIrohTransport({
      runtime: null,
      profile: {
        serverUrl: descriptor.canonicalServerUrl,
        localServerUrl: 'http://127.0.0.1:3005',
        homeConnectionDescriptor: descriptor,
      } as never,
      token: 'account-token',
      probe,
      publishRuntimeOrigin: vi.fn(),
    })).rejects.toThrow(/Iroh/i);

    expect(probe).not.toHaveBeenCalled();
  });

  it('allows unavailable Iroh to use only the descriptor-declared independently verified HTTPS origin', async () => {
    const httpsUrl = 'https://public-home.example.test';
    const descriptorWithHttpsFallback = {
      ...descriptor,
      endpoints: [...descriptor.endpoints, { kind: 'https' as const, url: httpsUrl }],
    };
    const probe = vi.fn(async ({ serverUrl }: { serverUrl: string }) => (
      serverUrl === httpsUrl
        ? { status: 'ready' as const }
        : { status: 'auth_failed' as const, errorMessage: 'unexpected origin' }
    ));
    const publish = vi.fn(() => vi.fn());

    const transport = await prepareDaemonHomeIrohTransport({
      runtime: null,
      profile: {
        serverUrl: descriptor.canonicalServerUrl,
        localServerUrl: 'http://127.0.0.1:3005',
        homeConnectionDescriptor: descriptorWithHttpsFallback,
      } as never,
      token: 'account-token',
      probe: probe as never,
      publishRuntimeOrigin: publish,
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: httpsUrl }));
    expect(publish).toHaveBeenCalledWith(httpsUrl, 'https');
    expect(transport).toMatchObject({ carrier: 'standard', observedPath: 'unknown' });
  });

  it('reports a transport outage as unreachable during reacquisition', async () => {
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn()
        .mockResolvedValueOnce({
          runtimeOrigin: 'http://127.0.0.1:48123',
          observedPath: 'direct' as const,
          release: vi.fn(async () => undefined),
        })
        .mockRejectedValueOnce(new IrohError('transport_timeout', 'timed out')),
    };
    const probe = vi.fn(async ({ serverUrl }: { serverUrl: string }) => (
      serverUrl === 'http://127.0.0.1:48123'
        ? { status: 'ready' as const }
        : { status: 'server_unreachable' as const, errorMessage: 'offline' }
    ));
    const transport = await prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl, homeConnectionDescriptor: descriptor } as never,
      token: 'account-token',
      readProfile: async () => ({
        serverUrl: descriptor.canonicalServerUrl,
        homeConnectionDescriptor: descriptor,
      }) as never,
      probe: probe as never,
      publishRuntimeOrigin: vi.fn(() => vi.fn()),
    });

    await expect(transport.reacquire()).resolves.toMatchObject({
      status: 'server_unreachable',
      errorMessage: 'timed out',
    });
  });

  it('reacquires with the current canonical profile instead of the startup descriptor', async () => {
    const replacementDescriptor = {
      ...descriptor,
      revision: descriptor.revision + 1,
      endpoints: [{ kind: 'iroh' as const, endpointId: 'd'.repeat(64) }],
    };
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn(async ({ descriptor: requestedDescriptor }) => ({
        runtimeOrigin: `http://127.0.0.1:${requestedDescriptor.revision === descriptor.revision ? 48123 : 48124}`,
        observedPath: 'direct' as const,
        release: vi.fn(async () => undefined),
      })),
    };
    const readProfile = vi.fn(async () => ({
      serverUrl: descriptor.canonicalServerUrl,
      homeConnectionDescriptor: replacementDescriptor,
    }));
    const transport = await prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl, homeConnectionDescriptor: descriptor } as never,
      token: 'account-token',
      readProfile: readProfile as never,
      probe: async () => ({ status: 'ready' }),
      publishRuntimeOrigin: vi.fn(() => vi.fn()),
    });

    await expect(transport.reacquire()).resolves.toEqual({ status: 'ready' });
    expect(readProfile).toHaveBeenCalledOnce();
    expect(runtime.ensureHomeTunnel.mock.calls.map(([input]) => input.descriptor)).toEqual([
      descriptor,
      replacementDescriptor,
    ]);
  });

  it('activates Iroh when the canonical profile learns a descriptor after startup', async () => {
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn(async () => ({
        runtimeOrigin: 'http://127.0.0.1:48124',
        observedPath: 'relay' as const,
        release: vi.fn(async () => undefined),
      })),
    };
    const transport = await prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl } as never,
      token: 'account-token',
      readProfile: async () => ({
        serverUrl: descriptor.canonicalServerUrl,
        homeConnectionDescriptor: descriptor,
      }) as never,
      probe: async () => ({ status: 'ready' }),
      publishRuntimeOrigin: vi.fn(() => vi.fn()),
    });

    expect(runtime.ensureHomeTunnel).not.toHaveBeenCalled();
    await expect(transport.reacquire()).resolves.toEqual({ status: 'ready' });
    expect(runtime.ensureHomeTunnel).toHaveBeenCalledWith({ descriptor });
    expect(transport.carrier).toBe('iroh');
    expect(transport.observedPath).toBe('relay');
  });

  it('requests replacement only when feature refresh accepts a newer descriptor', async () => {
    const requestReconnect = vi.fn();
    const reconcileDescriptor = vi.fn()
      .mockResolvedValueOnce({ outcome: 'updated' as const })
      .mockResolvedValueOnce({ outcome: 'unchanged' as const })
      .mockResolvedValueOnce({ outcome: 'stale' as const });
    const features = {
      homeConnectionDescriptor: descriptor,
      capabilities: { serverIdentity: { serverIdentityId: descriptor.homeServerIdentityId } },
    } as never;

    await applyDaemonHomeDescriptorRefresh({ features, reconcileDescriptor, requestReconnect });
    await applyDaemonHomeDescriptorRefresh({ features, reconcileDescriptor, requestReconnect });
    await applyDaemonHomeDescriptorRefresh({ features, reconcileDescriptor, requestReconnect });
    await applyDaemonHomeDescriptorRefresh({
      features: {
        capabilities: { serverIdentity: { serverIdentityId: descriptor.homeServerIdentityId } },
      } as never,
      reconcileDescriptor,
      requestReconnect,
    });

    expect(requestReconnect).toHaveBeenCalledOnce();
    expect(reconcileDescriptor).toHaveBeenCalledTimes(3);
  });

  it('retains a failed predecessor release and retries it during final teardown', async () => {
    let firstReleaseAttempt = true;
    const releaseFirst = vi.fn(async () => {
      if (firstReleaseAttempt) {
        firstReleaseAttempt = false;
        throw new Error('first stop failed');
      }
    });
    const releaseSecond = vi.fn(async () => undefined);
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn()
        .mockResolvedValueOnce({
          runtimeOrigin: 'http://127.0.0.1:48123', observedPath: 'direct' as const, release: releaseFirst,
        })
        .mockResolvedValueOnce({
          runtimeOrigin: 'http://127.0.0.1:48124', observedPath: 'direct' as const, release: releaseSecond,
        }),
    };
    const transport = await prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl, homeConnectionDescriptor: descriptor } as never,
      token: 'account-token',
      readProfile: async () => ({
        serverUrl: descriptor.canonicalServerUrl,
        homeConnectionDescriptor: descriptor,
      }) as never,
      probe: async () => ({ status: 'ready' }),
      publishRuntimeOrigin: vi.fn(() => vi.fn()),
    });

    await expect(transport.reacquire()).resolves.toEqual({ status: 'ready' });
    await transport.release();

    expect(releaseFirst).toHaveBeenCalledTimes(2);
    expect(releaseSecond).toHaveBeenCalledTimes(1);
  });

  it('owns and disposes a replacement that completes after terminal release starts', async () => {
    const releaseInitial = vi.fn(async () => undefined);
    const releaseLate = vi.fn(async () => undefined);
    let resolveLate: ((lease: { runtimeOrigin: string; observedPath: 'relay'; release: typeof releaseLate }) => void) | null = null;
    const runtime = {
      available: true as const,
      ensureHomeTunnel: vi.fn()
        .mockResolvedValueOnce({
          runtimeOrigin: 'http://127.0.0.1:48123', observedPath: 'direct' as const, release: releaseInitial,
        })
        .mockImplementationOnce(async () => await new Promise((resolve) => {
          resolveLate = resolve;
        })),
    };
    const unpublishInitial = vi.fn();
    const unpublishLate = vi.fn();
    const publish = vi.fn()
      .mockReturnValueOnce(unpublishInitial)
      .mockReturnValueOnce(unpublishLate);
    const transport = await prepareDaemonHomeIrohTransport({
      runtime: runtime as never,
      profile: { serverUrl: descriptor.canonicalServerUrl, homeConnectionDescriptor: descriptor } as never,
      token: 'account-token',
      readProfile: async () => ({
        serverUrl: descriptor.canonicalServerUrl,
        homeConnectionDescriptor: descriptor,
      }) as never,
      probe: async () => ({ status: 'ready' }),
      publishRuntimeOrigin: publish,
    });

    const reacquire = transport.reacquire();
    await vi.waitFor(() => expect(resolveLate).toBeTypeOf('function'));
    const release = transport.release();
    resolveLate!({
      runtimeOrigin: 'http://127.0.0.1:48124',
      observedPath: 'relay',
      release: releaseLate,
    });

    await expect(reacquire).resolves.toMatchObject({ status: 'server_unreachable' });
    await release;
    expect(unpublishLate).toHaveBeenCalledTimes(1);
    expect(releaseLate).toHaveBeenCalledTimes(1);
  });
});
