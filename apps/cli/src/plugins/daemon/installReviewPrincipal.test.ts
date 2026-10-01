import { describe, expect, it } from 'vitest';

import type { PluginInstallationReview } from '@happier-dev/protocol/marketplace/internal';
import {
  derivePluginInstallReviewPrincipal,
  derivePluginInstallReviewPrincipalDigest,
} from './installReviewPrincipal';

function review() {
  return {
    pluginId: 'happier.voice.openai',
    displayName: 'OpenAI Voice',
    version: '1.0.0',
    packageIdentity: { name: '@happier/plugin-voice-openai', version: '1.0.0' },
    publisherIdentity: { status: 'unverified', id: 'happier', displayName: 'Happier' },
    source: { kind: 'npm', locator: '@happier/plugin-voice-openai@1.0.0', integrity: 'sha512-old', integrityBasis: 'expected' },
    updateChannel: {
      kind: 'npm',
      packageName: '@happier/plugin-voice-openai',
      registryOrigin: 'https://registry.npmjs.org',
    },
    signature: { status: 'verified', keyId: 'publisher-key-1' },
    provenance: { status: 'notProvided' },
    curation: { status: 'notApplicable' },
    executableRealms: ['daemon'],
    contributions: [],
    requestInterceptors: [],
    uiArtifacts: { status: 'none', contributionIds: [] },
    requiredHostAccess: [],
    optionalHostAccess: [],
    rawCredentialAccess: [],
    compatibility: { happier: '*', runtimeApiVersion: 1 },
    updatePolicy: 'allowed',
  } satisfies PluginInstallationReview;
}

describe('plugin install-review principal digest', () => {
  it('is stable across package versions and mutable runtime bytes', () => {
    const initial = review();
    const updated = {
      ...initial,
      version: '2.0.0',
      packageIdentity: { ...initial.packageIdentity, version: '2.0.0' },
      source: { ...initial.source, locator: '@happier/plugin-voice-openai@2.0.0', integrity: 'sha512-new' },
    } satisfies PluginInstallationReview;

    expect(derivePluginInstallReviewPrincipal(updated).digest)
      .toBe(derivePluginInstallReviewPrincipal(initial).digest);
  });

  it('changes only with plugin/package or trusted distribution identity', () => {
    const initial = review();
    const digest = derivePluginInstallReviewPrincipal(initial).digest;

    expect(derivePluginInstallReviewPrincipal({
      ...initial,
      packageIdentity: { ...initial.packageIdentity, name: '@acme/voice' },
    }).digest).not.toBe(digest);
    expect(derivePluginInstallReviewPrincipal({
      ...initial,
      updateChannel: { ...initial.updateChannel, registryOrigin: 'https://registry.acme.test' },
    }).digest).not.toBe(digest);
    expect(derivePluginInstallReviewPrincipal({
      ...initial,
      updateChannel: { ...initial.updateChannel, registryProfileId: 'acme-profile' },
    }).digest).not.toBe(digest);
    expect(derivePluginInstallReviewPrincipal({
      ...initial,
      updateChannel: {
        kind: 'path',
        locator: '/Users/alice/private/plugins/voice',
        development: false,
      },
    }).digest).not.toBe(digest);
  });

  it('excludes unverified catalog publisher presentation and npm registry signature keys', () => {
    const initial = review();
    const principal = derivePluginInstallReviewPrincipal(initial);
    const digest = principal.digest;

    // Registry signing keys authenticate the registry response, not the plugin
    // publisher shown by a discovery catalog; catalog publisher labels are
    // unverified presentation/curation metadata. Key rotation and label changes
    // are not publisher-channel changes (PEP-SDK r0.77 / PEP-MASTER r0.138).
    expect(derivePluginInstallReviewPrincipal({
      ...initial,
      publisherIdentity: {
        status: 'unverified',
        id: 'acme',
        displayName: 'Acme',
      },
    }).digest).toBe(digest);
    expect(derivePluginInstallReviewPrincipal({
      ...initial,
      publisherIdentity: { status: 'unavailable' },
    }).digest).toBe(digest);
    expect(derivePluginInstallReviewPrincipal({
      ...initial,
      signature: { status: 'verified', keyId: 'registry-key-rotated' },
    }).digest).toBe(digest);
    expect(derivePluginInstallReviewPrincipal({
      ...initial,
      signature: { status: 'notProvided' },
    }).digest).toBe(digest);

    expect('publisherIdentity' in principal.presentation).toBe(false);
    expect('packageSignature' in principal.presentation).toBe(false);
  });

  it('returns a safe presentation from the exact facts used by the digest', () => {
    const npm = derivePluginInstallReviewPrincipal(review());
    expect(npm.presentation).toEqual({
      v: 1,
      packageIdentity: {
        pluginId: 'happier.voice.openai',
        packageName: '@happier/plugin-voice-openai',
      },
      distributionIdentity: {
        kind: 'npm',
        packageName: '@happier/plugin-voice-openai',
        registryOrigin: 'https://registry.npmjs.org',
      },
    });
    expect(derivePluginInstallReviewPrincipalDigest(npm.presentation)).toBe(npm.digest);

    const path = derivePluginInstallReviewPrincipal({
      ...review(),
      source: {
        kind: 'path',
        locator: '/Users/alice/private/plugins/voice',
      },
      updateChannel: {
        kind: 'path',
        locator: '/Users/alice/private/plugins/voice',
        development: true,
      },
      signature: { status: 'notProvided' },
    });
    expect(path.presentation.distributionIdentity).toEqual({
      kind: 'path',
      development: true,
    });
    expect(path.presentation).toEqual({
      v: 1,
      packageIdentity: {
        pluginId: 'happier.voice.openai',
        packageName: '@happier/plugin-voice-openai',
      },
      distributionIdentity: { kind: 'path', development: true },
    });

    const archive = derivePluginInstallReviewPrincipal({
      ...review(),
      source: {
        kind: 'archive',
        locator: 'https://user:password@example.test/private/plugin.tgz?token=secret',
        integrity: 'secret-integrity',
        integrityBasis: 'observed',
      },
      updateChannel: {
        kind: 'archive',
        locator: 'https://user:password@example.test/private/plugin.tgz?token=secret',
      },
      signature: { status: 'notProvided' },
    });
    expect(archive.presentation.distributionIdentity).toEqual({ kind: 'archive' });
    expect(JSON.stringify([path.presentation, archive.presentation])).not.toContain('alice');
    expect(JSON.stringify([path.presentation, archive.presentation])).not.toContain('password');
    expect(JSON.stringify([path.presentation, archive.presentation])).not.toContain('integrity');
  });
});
