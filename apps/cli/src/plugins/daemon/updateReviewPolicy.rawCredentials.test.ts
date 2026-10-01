import { describe, expect, it } from 'vitest';

import { validatePluginManifest } from '@/plugins/manifest/validate';

import { projectPluginInstallationReview } from './installationReview';
import { hasPluginAuthorityExpansion } from './updateReviewPolicy';

type RawGrant = Readonly<{
  realm: 'web' | 'ios' | 'android' | 'daemon';
  phase: 'settings' | 'prepare' | 'connection' | 'speech';
  request: Readonly<{ kind: 'httpHeaders'; origin: string; headerNames: readonly string[] }>;
}>;

const SAVED_SECRET_GRANT: RawGrant = {
  realm: 'web',
  phase: 'connection',
  request: {
    kind: 'httpHeaders',
    origin: 'https://voice.example.test',
    headerNames: ['authorization'],
  },
};

const CONNECTED_ACCOUNT_GRANT: RawGrant = {
  realm: 'ios',
  phase: 'prepare',
  request: {
    kind: 'httpHeaders',
    origin: 'https://voice.example.test',
    headerNames: ['x-account-token'],
  },
};

function createManifest(options: Readonly<{
  version?: string;
  savedSecretKinds?: readonly ('apiKey' | 'token' | 'password' | 'other')[];
  savedSecretGrants?: readonly RawGrant[];
  connectedAccountGrants?: readonly RawGrant[];
}> = {}) {
  const result = validatePluginManifest({
    schemaVersion: 2,
    id: 'acme.raw-voice-credentials',
    version: options.version ?? '1.0.0',
    displayName: 'Raw voice credentials',
    engines: { happier: '>=0.0.0' },
    runtime: { apiVersion: 1 },
    entrypoints: { daemon: './dist/daemon.mjs' },
    hostAccess: { required: [], optional: [] },
    contributes: {
      voiceProviders: [{
        id: 'raw-voice',
        title: 'Raw Voice',
        kind: 'conversation',
        roles: ['realtime_conversation'],
        platforms: ['web', 'ios'],
        capabilities: { turn: { cancelResponse: false, bargeIn: false } },
        credentials: {
          slot: {
            id: 'voice_auth',
            purpose: 'voice.client-auth',
            title: 'Voice credential',
          },
          requirement: { kind: 'always' },
          sources: [{
            kind: 'savedSecret',
            secretKinds: [...(options.savedSecretKinds ?? ['apiKey'])],
            rawGrants: [...(options.savedSecretGrants ?? [SAVED_SECRET_GRANT])],
          }, {
            kind: 'connectedAccount',
            service: { pluginId: 'acme.voice-account', localId: 'oauth' },
            rawGrants: [...(options.connectedAccountGrants ?? [CONNECTED_ACCOUNT_GRANT])],
          }],
        },
        client: {
          artifactId: 'raw-voice-client',
          exportName: 'activate',
        },
      }],
    },
  }, { sourceProvenance: 'registryCustodied' });
  if (!result.ok) throw new Error(`Fixture manifest rejected: ${JSON.stringify(result.diagnostics)}`);
  return result.manifest;
}

describe('hasPluginAuthorityExpansion raw credential disclosure', () => {
  it('admits an update that leaves every disclosed raw credential fact identical', () => {
    expect(hasPluginAuthorityExpansion(
      createManifest(),
      createManifest({ version: '1.0.1' }),
      [],
    )).toBe(false);
  });

  it('requires review when an already-declared contribution adds a raw credential grant', () => {
    expect(hasPluginAuthorityExpansion(
      createManifest(),
      createManifest({
        version: '1.0.1',
        savedSecretGrants: [SAVED_SECRET_GRANT, {
          realm: 'ios',
          phase: 'connection',
          request: {
            kind: 'httpHeaders',
            origin: 'https://voice.example.test',
            headerNames: ['authorization'],
          },
        }],
      }),
      [],
    )).toBe(true);
  });

  it('requires review when a retained raw credential grant changes a disclosed fact', () => {
    const previous = createManifest();
    const changedRealm = createManifest({
      version: '1.0.1',
      savedSecretGrants: [{ ...SAVED_SECRET_GRANT, realm: 'ios' }],
    });
    const changedPhase = createManifest({
      version: '1.0.1',
      savedSecretGrants: [{ ...SAVED_SECRET_GRANT, phase: 'settings' }],
    });
    const changedRequest = createManifest({
      version: '1.0.1',
      savedSecretGrants: [{
        ...SAVED_SECRET_GRANT,
        request: { ...SAVED_SECRET_GRANT.request, headerNames: ['x-api-key'] },
      }],
    });
    const changedSourceClass = createManifest({
      version: '1.0.1',
      savedSecretKinds: ['token'],
    });

    for (const candidate of [changedRealm, changedPhase, changedRequest, changedSourceClass]) {
      expect(hasPluginAuthorityExpansion(previous, candidate, [])).toBe(true);
    }
  });

  it('compares exactly the raw credential facts the installation review discloses', () => {
    const previous = createManifest();
    const candidate = createManifest({
      version: '1.0.1',
      connectedAccountGrants: [{
        ...CONNECTED_ACCOUNT_GRANT,
        request: {
          ...CONNECTED_ACCOUNT_GRANT.request,
          headerNames: ['x-account-token', 'x-account-tenant'],
        },
      }],
    });
    const review = (manifest: typeof previous) => projectPluginInstallationReview({
      manifest,
      source: {
        kind: 'path',
        locator: '/tmp/raw-voice-credentials',
        development: false,
        packageName: null,
        publisher: { status: 'unavailable' },
        signature: { status: 'notProvided' },
        provenance: { status: 'notProvided' },
        curation: { status: 'notApplicable' },
        updatePolicy: 'allowed',
      },
      uiArtifacts: { verification: 'unavailable', contributionIds: [] },
    }).rawCredentialAccess;

    expect(review(candidate)).not.toEqual(review(previous));
    expect(hasPluginAuthorityExpansion(previous, candidate, [])).toBe(true);
  });
});
