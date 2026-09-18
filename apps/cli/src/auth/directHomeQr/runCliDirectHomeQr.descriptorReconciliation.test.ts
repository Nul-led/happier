import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHomeQrInviteV2Payload, type HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';

const featureBoundary = vi.hoisted(() => ({
  read: vi.fn(),
}));

const carrierBoundary = vi.hoisted(() => ({
  acquire: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('@/features/serverFeaturesClient', () => ({
  observeServerFeaturesSnapshot: featureBoundary.read,
}));

vi.mock('@/auth/terminalAuthEnrollmentRuntime', () => ({
  acquireTerminalAuthEnrollmentRuntime: carrierBoundary.acquire,
}));

function descriptor(input: Readonly<{
  revision: number;
  identity?: string;
  origin?: string;
}>): HomeConnectionDescriptorV1 {
  const origin = input.origin ?? 'https://qr-home.example.test';
  return {
    v: 1,
    homeServerIdentityId: input.identity ?? 'srv_qr_home',
    canonicalServerUrl: origin,
    revision: input.revision,
    endpoints: [{ kind: 'https', url: origin }],
  };
}

describe('CLI direct Home QR descriptor reconciliation', () => {
  let envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL'] as const);

  afterEach(() => {
    envScope.restore();
    envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL'] as const);
    featureBoundary.read.mockReset();
    carrierBoundary.acquire.mockReset();
    carrierBoundary.close.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function runCase(
    stored: HomeConnectionDescriptorV1,
    observed: HomeConnectionDescriptorV1,
    boundQrV2Enabled = true,
    options: Readonly<{ abortDuringAcquire?: boolean; abortAfterFeatureRead?: boolean }> = {},
  ) {
    return await withTempDir('happier-cli-direct-qr-descriptor-', async (homeDir) => {
      envScope.patch({
        HAPPIER_HOME_DIR: homeDir,
        HAPPIER_SERVER_URL: undefined,
        HAPPIER_WEBAPP_URL: undefined,
      });
      vi.resetModules();
      const { reloadConfiguration } = await import('@/configuration');
      reloadConfiguration();
      const profiles = await import('@/server/serverProfiles');
      const { writeCredentialsTokenOnlyForServerId } = await import('@/persistence');
      const { runCliDirectHomeQr } = await import('./runCliDirectHomeQr');

      const profile = await profiles.addServerProfile({
        name: 'qr-home',
        serverUrl: stored.canonicalServerUrl,
        webappUrl: stored.canonicalServerUrl,
        use: true,
      });
      await profiles.adoptServerProfileHomeConnectionDescriptor({
        descriptor: stored,
        expectedProfileId: profile.id,
        observation: 'exact',
      });
      await writeCredentialsTokenOnlyForServerId(profile.id, { token: 'home-token' });
      const controller = new AbortController();
      if (options.abortDuringAcquire) {
        carrierBoundary.acquire.mockImplementation(async () => {
          controller.abort(new DOMException('cancelled', 'AbortError'));
          return { ok: false, reason: 'unavailable', error: new Error('carrier cancelled') };
        });
      } else {
        carrierBoundary.acquire.mockResolvedValue({
          ok: true,
          runtime: {
            runtimeOrigin: stored.canonicalServerUrl,
            carrier: 'https',
            authenticatedCredentialDestination: {
              kind: 'https',
              applicationUrl: stored.canonicalServerUrl,
            },
          },
          close: carrierBoundary.close,
        });
      }
      featureBoundary.read.mockResolvedValue({
        status: 'ready',
        features: {
          features: { auth: { pairing: { boundQrV2: { enabled: boundQrV2Enabled } } } },
          homeConnectionDescriptor: observed,
        },
      });
      if (options.abortAfterFeatureRead) {
        featureBoundary.read.mockImplementationOnce(async () => {
          controller.abort(new DOMException('cancelled', 'AbortError'));
          return {
            status: 'ready',
            features: {
              features: { auth: { pairing: { boundQrV2: { enabled: boundQrV2Enabled } } } },
              homeConnectionDescriptor: observed,
            },
          };
        });
      }

      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        if (path === '/v1/auth/pairing/start') {
          return new Response(JSON.stringify({ pairId: 'pair-1', expiresAt }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (path === '/v1/auth/pairing/status') {
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('cancelled');
              error.name = 'AbortError';
              reject(error);
            }, { once: true });
          });
        }
        if (path === '/v1/auth/pairing/consume') return new Response(null, { status: 204 });
        throw new Error(`Unexpected direct QR request: ${path}`);
      }));

      let inviteDescriptor: HomeConnectionDescriptorV1 | null = null;
      const result = await runCliDirectHomeQr({
        profileRef: profile.id,
        copyLink: true,
        signal: controller.signal,
        onInvite: ({ link }) => {
          try {
            const payload = new URL(link).searchParams.get('payload');
            const invite = payload
              ? parseHomeQrInviteV2Payload(payload, { nowMs: Date.now() })
              : null;
            inviteDescriptor = invite?.home ?? null;
          } finally {
            controller.abort();
          }
        },
      });
      return {
        result,
        inviteDescriptor,
        profile: await profiles.getServerProfile(profile.id),
      };
    });
  }

  it('uses the authenticated newer descriptor generation in the emitted invite', async () => {
    const current = descriptor({ revision: 2 });
    const outcome = await runCase(descriptor({ revision: 1 }), current);

    expect(outcome.result).toEqual({ kind: 'cancelled' });
    expect(outcome.inviteDescriptor).toEqual(current);
    expect(outcome.profile.homeConnectionDescriptor).toEqual(current);
  });

  it('reports cancellation when caller aborts during descriptor carrier acquisition', async () => {
    const stored = descriptor({ revision: 2 });
    const outcome = await runCase(stored, stored, true, { abortDuringAcquire: true });

    expect(outcome.result).toEqual({ kind: 'cancelled' });
    expect(featureBoundary.read).not.toHaveBeenCalled();
  });

  it('reports cancellation and closes the carrier when caller aborts before pairing starts', async () => {
    const stored = descriptor({ revision: 2 });
    const outcome = await runCase(stored, stored, true, { abortAfterFeatureRead: true });

    expect(outcome.result).toEqual({ kind: 'cancelled' });
    expect(carrierBoundary.close).toHaveBeenCalledOnce();
  });

  it('keeps the stored current generation when the authenticated observation is stale', async () => {
    const current = descriptor({ revision: 2 });
    const outcome = await runCase(current, descriptor({ revision: 1 }));

    expect(outcome.result).toEqual({ kind: 'cancelled' });
    expect(outcome.inviteDescriptor).toEqual(current);
    expect(outcome.profile.homeConnectionDescriptor).toEqual(current);
  });

  it('fails closed on equal-revision conflict before emitting an invite', async () => {
    const stored = descriptor({ revision: 2 });
    const conflicting = {
      ...stored,
      endpoints: [{ kind: 'https' as const, url: 'https://other-ingress.example.test' }],
    };
    const outcome = await runCase(stored, conflicting);

    expect(outcome.result).toEqual({ kind: 'failed', status: 412 });
    expect(outcome.inviteDescriptor).toBeNull();
    expect(outcome.profile.homeConnectionDescriptor).toEqual(stored);
  });

  it('fails closed when the authenticated descriptor belongs to another Home', async () => {
    const stored = descriptor({ revision: 2 });
    const outcome = await runCase(stored, descriptor({ revision: 3, identity: 'srv_other_home' }));

    expect(outcome.result).toEqual({ kind: 'failed', status: 412 });
    expect(outcome.inviteDescriptor).toBeNull();
    expect(outcome.profile.homeConnectionDescriptor).toEqual(stored);
  });

  it('does not persist an observed descriptor before the bound-QR capability admits the flow', async () => {
    const stored = descriptor({ revision: 1 });
    const observed = descriptor({ revision: 2 });
    const outcome = await runCase(stored, observed, false);

    expect(outcome.result).toEqual({ kind: 'update_required' });
    expect(outcome.inviteDescriptor).toBeNull();
    expect(outcome.profile.homeConnectionDescriptor).toEqual(stored);
  });
});
