import { describe, expect, it, vi } from 'vitest';

import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { FeaturesResponseSchema, HomeConnectionDescriptorV1Schema } from '@happier-dev/protocol';
import type { ResolvedHomeTarget } from '@happier-dev/cli-common/homeTarget';
import { fetchServerFeaturesSnapshot } from '@/features/serverFeaturesClient';

import {
  claimTerminalAuthRequest,
  createTerminalAuthRequest,
  readTerminalAuthRequestStatus,
  resolveAuthenticatedExactHomeConnectionDescriptorObservation,
  verifyTerminalAuthEnrollmentRuntime,
} from './terminalAuthEnrollmentClient';

const DESCRIPTOR = HomeConnectionDescriptorV1Schema.parse({
  v: 1,
  homeServerIdentityId: 'srv_home_expected',
  canonicalServerUrl: 'https://home.example.test',
  revision: 1,
  endpoints: [
    { kind: 'https', url: 'https://home.example.test' },
    { kind: 'iroh', endpointId: 'a'.repeat(64) },
  ],
});

const STRICT_TARGET = {
  profileId: 'home',
  homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
  descriptor: DESCRIPTOR,
  canonicalAuthUrl: DESCRIPTOR.canonicalServerUrl,
  applicationUrl: DESCRIPTOR.canonicalServerUrl,
  webappUrl: 'https://app.example.test',
  credentialDestination: {
    v: 1,
    homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
    canonicalServerUrl: DESCRIPTOR.canonicalServerUrl,
    applicationEndpointUrls: [DESCRIPTOR.canonicalServerUrl],
    irohEndpointIds: ['a'.repeat(64)],
  },
  preferredTransport: 'iroh',
  authority: 'saved_profile',
} satisfies ResolvedHomeTarget;

function readyFeatures(params: Readonly<{
  identity?: string;
  descriptor?: typeof DESCRIPTOR;
  provenance?: 'authenticated' | 'public';
}> = {}): CliServerFeaturesSnapshot {
  const descriptor = 'descriptor' in params ? params.descriptor : DESCRIPTOR;
  return {
    status: 'ready',
    provenance: params.provenance ?? 'authenticated',
    features: {
      ...FeaturesResponseSchema.parse({
        features: {},
        capabilities: {
        serverIdentity: { serverIdentityId: params.identity ?? DESCRIPTOR.homeServerIdentityId },
        },
      }),
      ...(descriptor ? { homeConnectionDescriptor: descriptor } : {}),
    },
  };
}

describe('terminal auth enrollment client', () => {
  it('distinguishes an unreadable feature response from an absent Home identity', async () => {
    const snapshot = await fetchServerFeaturesSnapshot({
      serverUrl: 'https://home.example.test',
      fetchImpl: async () => new Response(JSON.stringify({
        features: 'unreadable',
      })),
    });
    expect(snapshot).toEqual({ status: 'unsupported', reason: 'invalid_payload' });
    const verify = (snapshot: CliServerFeaturesSnapshot) => verifyTerminalAuthEnrollmentRuntime({
      target: STRICT_TARGET,
      runtime: {
        runtimeOrigin: 'http://127.0.0.1:48123',
        carrier: 'iroh',
        authenticatedCredentialDestination: { kind: 'iroh', endpointId: 'a'.repeat(64) },
      },
      snapshot,
    });
    let unreadableError: unknown;
    try { verify(snapshot); } catch (error) { unreadableError = error; }
    expect(unreadableError).toMatchObject({ code: 'HOME_FEATURES_UNREADABLE' });
    expect(verify.bind(null, readyFeatures({ identity: '' }))).toThrow('Unable to verify the selected Home identity');
  });

  it('sends request, status, and claim only through the explicit acquired runtime origin', async () => {
    const post = vi.fn(async (url: string) => ({ data: { url } }));
    const get = vi.fn(async (url: string) => ({ data: { url } }));
    const runtime = {
      runtimeOrigin: 'http://127.0.0.1:48123',
      carrier: 'iroh' as const,
      authenticatedCredentialDestination: { kind: 'iroh' as const, endpointId: 'a'.repeat(64) },
    };

    await createTerminalAuthRequest({
      runtime,
      publicKey: 'public-key',
      claimSecretHash: 'claim-hash',
      post,
    });
    await readTerminalAuthRequestStatus({ runtime, publicKey: 'public-key', get });
    await claimTerminalAuthRequest({
      runtime,
      publicKey: 'public-key',
      claimSecret: 'claim-secret',
      post,
    });

    expect(post.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:48123/v1/auth/request',
      'http://127.0.0.1:48123/v1/auth/request/claim',
    ]);
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:48123/v1/auth/request/status',
    ]);
  });

  it('accepts a strict descriptor only after features prove the exact identity and acquired destination', () => {
    expect(verifyTerminalAuthEnrollmentRuntime({
      target: STRICT_TARGET,
      runtime: {
        runtimeOrigin: 'http://127.0.0.1:48123',
        carrier: 'iroh',
        authenticatedCredentialDestination: { kind: 'iroh', endpointId: 'a'.repeat(64) },
      },
      snapshot: readyFeatures(),
    })).toEqual({
      homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
      credentialDestination: { kind: 'iroh', endpointId: 'a'.repeat(64) },
    });
  });

  it.each([
    ['wrong identity', readyFeatures({ identity: 'srv_home_wrong' }), { kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
    ['wrong endpoint', readyFeatures(), { kind: 'iroh' as const, endpointId: 'b'.repeat(64) }],
    ['missing descriptor', readyFeatures({ descriptor: undefined }), { kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
  ])('rejects a strict target with %s before request admission', (_label, snapshot, destination) => {
    expect(() => verifyTerminalAuthEnrollmentRuntime({
      target: STRICT_TARGET,
      runtime: {
        runtimeOrigin: 'http://127.0.0.1:48123',
        carrier: 'iroh',
        authenticatedCredentialDestination: destination,
      },
      snapshot,
    })).toThrow();
  });

  it('preserves explicit legacy URL-only HTTPS admission without granting descriptor authority', () => {
    const target = {
      profileId: null,
      homeServerIdentityId: null,
      descriptor: null,
      canonicalAuthUrl: 'https://legacy.example.test',
      applicationUrl: 'https://legacy.example.test',
      webappUrl: 'https://legacy.example.test',
      credentialDestination: null,
      preferredTransport: 'https',
      authority: 'manual_url',
    } satisfies ResolvedHomeTarget;

    expect(verifyTerminalAuthEnrollmentRuntime({
      target,
      runtime: {
        runtimeOrigin: 'https://legacy.example.test',
        carrier: 'https',
        authenticatedCredentialDestination: {
          kind: 'https',
          applicationUrl: 'https://legacy.example.test',
        },
      },
      snapshot: readyFeatures({ descriptor: undefined, provenance: 'public' }),
    })).toEqual({
      homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
      credentialDestination: {
        kind: 'https',
        applicationUrl: 'https://legacy.example.test',
      },
    });
  });

  it('distinguishes authenticated exact descriptor authority from public fallback', () => {
    expect(resolveAuthenticatedExactHomeConnectionDescriptorObservation({
      snapshot: readyFeatures({ provenance: 'authenticated' }),
      expectedHomeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
    })).toEqual({ kind: 'available', descriptor: DESCRIPTOR });

    expect(resolveAuthenticatedExactHomeConnectionDescriptorObservation({
      snapshot: readyFeatures({ provenance: 'public' }),
      expectedHomeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
    })).toEqual({ kind: 'unavailable' });
  });

  it('rejects URL-only admission over Iroh or a different HTTPS origin', () => {
    const target = {
      profileId: null,
      homeServerIdentityId: null,
      descriptor: null,
      canonicalAuthUrl: 'https://legacy.example.test',
      applicationUrl: 'https://legacy.example.test',
      webappUrl: 'https://legacy.example.test',
      credentialDestination: null,
      preferredTransport: 'https',
      authority: 'manual_url',
    } satisfies ResolvedHomeTarget;

    for (const runtime of [
      {
        runtimeOrigin: 'http://127.0.0.1:48123',
        carrier: 'iroh' as const,
        authenticatedCredentialDestination: { kind: 'iroh' as const, endpointId: 'a'.repeat(64) },
      },
      {
        runtimeOrigin: 'https://other.example.test',
        carrier: 'https' as const,
        authenticatedCredentialDestination: {
          kind: 'https' as const,
          applicationUrl: 'https://other.example.test',
        },
      },
    ]) {
      expect(() => verifyTerminalAuthEnrollmentRuntime({
        target,
        runtime,
        snapshot: readyFeatures({ descriptor: undefined }),
      })).toThrow();
    }
  });
});
