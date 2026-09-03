import { describe, expect, it } from 'vitest';
import type { ConnectedAccountPurposeDeclarationV1 } from '@happier-dev/protocol';

import { readCanonicalPluginManifest } from '@/plugins/manifest/normalize';
import {
  createDefaultPluginAccessScopeRegistry,
  type PluginAccessSelection,
} from '@/plugins/store/install/accessScopeRegistry';
import { createPluginManifestV2Fixture } from '@/plugins/testkit/manifestV2Fixture';

import {
  hasReviewSensitivePluginUpdate,
  preserveValidPluginOptionalSelections,
} from './updateReviewPolicy';

const registry = createDefaultPluginAccessScopeRegistry();

function manifest(
  materializationKinds?: readonly ('environment' | 'files')[],
  service: ConnectedAccountPurposeDeclarationV1['service'] = 'account',
) {
  const parsed = readCanonicalPluginManifest(createPluginManifestV2Fixture({
    id: 'acme.consumer',
    hostAccess: {
      required: [],
      optional: [{
        id: 'upstream',
        capability: 'connectedAccounts',
        reason: 'Use the selected upstream account',
        scope: {
          serviceRefs: [service],
          operations: ['use'],
          ...(materializationKinds !== undefined
            ? { materializationKinds: [...materializationKinds] }
            : {}),
        },
      }],
    },
  }));
  if (!parsed) throw new Error('Expected canonical Connected Accounts manifest');
  return parsed;
}

function upstreamSelection(
  materializationKinds?: readonly ('environment' | 'files')[],
): PluginAccessSelection {
  return registry.createSelection({
    pluginId: 'acme.consumer',
    accessId: 'upstream',
    capability: 'connectedAccounts',
    scope: {
      serviceRefs: ['account'],
      operations: ['use'],
      ...(materializationKinds !== undefined
        ? { materializationKinds: [...materializationKinds] }
        : {}),
    },
    selectedAtMs: 1,
  });
}

function agentManifest(
  materializationKinds?: readonly ('environment' | 'files')[],
  service: ConnectedAccountPurposeDeclarationV1['service'] = 'account',
) {
  const parsed = readCanonicalPluginManifest(createPluginManifestV2Fixture({
    id: 'acme.agent.consumer',
    contributes: {
      agents: [{
        id: 'consumer',
        title: 'Consumer',
        runtime: { kind: 'custom' },
        primary: 'sessions',
        connectedAccounts: [{
          purpose: 'upstream',
          service,
          ...(materializationKinds !== undefined
            ? { materializationKinds: [...materializationKinds] }
            : {}),
        }],
        capabilities: {
          sessions: {
            open: ['create'],
            delivery: ['newTurn'],
            cancel: true,
          },
        },
      }],
    },
  }));
  if (!parsed) throw new Error('Expected canonical Connected Accounts Agent manifest');
  return parsed;
}

function networkManifest(service: ConnectedAccountPurposeDeclarationV1['service']) {
  const parsed = readCanonicalPluginManifest(createPluginManifestV2Fixture({
    id: 'acme.consumer',
    hostAccess: {
      required: [{
        id: 'upstream-origin',
        capability: 'network',
        reason: 'Call the selected upstream account',
        scope: {
          targets: [{ kind: 'connectedAccountOrigin', service }],
          methods: ['GET'],
        },
      }],
      optional: [],
    },
  }));
  if (!parsed) throw new Error('Expected canonical Connected Accounts network manifest');
  return parsed;
}

function networkClientManifest(privateNetwork = false) {
  const parsed = readCanonicalPluginManifest(createPluginManifestV2Fixture({
    id: 'acme.websocket-consumer',
    hostAccess: {
      required: [{
        id: 'loopback-gateway',
        capability: 'network.client',
        reason: 'Maintain the declared local gateway connection',
        scope: {
          targets: [{ kind: 'fixedOrigin', origin: 'http://127.0.0.1:4311' }],
          transports: ['websocket'],
          ...(privateNetwork ? { privateNetwork: true } : {}),
        },
      }],
      optional: [],
    },
  }));
  if (!parsed) throw new Error('Expected canonical network.client manifest');
  return parsed;
}

function interceptorManifest(requestInterceptors: readonly Readonly<Record<string, unknown>>[]) {
  const parsed = readCanonicalPluginManifest(createPluginManifestV2Fixture({
    id: 'acme.interceptor-policy',
    contributes: {
      requestInterceptors: requestInterceptors.map((interceptor) => ({ ...interceptor })),
    },
  }));
  if (!parsed) throw new Error('Expected canonical request-interceptor manifest');
  return parsed;
}

describe('Connected Accounts plugin update review policy', () => {
  it('treats kind order as canonical and reopens review only for a selected materialization expansion', () => {
    const current = manifest(['environment', 'files']);
    const granted = [upstreamSelection(['environment', 'files'])];

    expect(hasReviewSensitivePluginUpdate(
      current,
      manifest(['files', 'environment']),
      granted,
    )).toBe(false);
    expect(hasReviewSensitivePluginUpdate(
      current,
      manifest(['environment']),
      granted,
    )).toBe(false);
    expect(hasReviewSensitivePluginUpdate(
      current,
      manifest(),
      granted,
    )).toBe(false);
    expect(hasReviewSensitivePluginUpdate(
      manifest(['environment']),
      current,
      [upstreamSelection(['environment'])],
    )).toBe(true);
  });

  /**
   * An unselected optional declaration grants nothing, so widening it discloses
   * a request the user can still refuse rather than authority they now hold.
   */
  it('does not reopen review for a materialization expansion the user never selected', () => {
    expect(hasReviewSensitivePluginUpdate(
      manifest(['environment']),
      manifest(['environment', 'files']),
      [],
    )).toBe(false);
  });

  it('carries an optional selection forward only while the declaration stays inside it', () => {
    const selection = upstreamSelection(['environment']);

    expect(preserveValidPluginOptionalSelections(
      'acme.consumer',
      manifest(['environment']),
      [selection],
    )).toEqual([selection]);
    expect(preserveValidPluginOptionalSelections(
      'acme.consumer',
      manifest(['environment', 'files']),
      [selection],
    )).toBeNull();
    expect(preserveValidPluginOptionalSelections(
      'acme.consumer',
      manifest(),
      [selection],
    )).toEqual([upstreamSelection()]);
    expect(preserveValidPluginOptionalSelections(
      'acme.consumer',
      manifest(['environment'], {
        pluginId: 'acme.consumer',
        localId: 'account',
      }),
      [selection],
    )).toEqual([selection]);
    expect(preserveValidPluginOptionalSelections(
      'acme.consumer',
      manifest(['environment'], {
        pluginId: 'acme.accounts',
        localId: 'account',
      }),
      [selection],
    )).toBeNull();
  });

  it('makes generated Agent purpose materialization expansion review-sensitive in one direction', () => {
    const current = agentManifest(['environment', 'files']);

    expect(hasReviewSensitivePluginUpdate(
      current,
      agentManifest(['files', 'environment']),
      [],
    )).toBe(false);
    expect(hasReviewSensitivePluginUpdate(
      current,
      agentManifest(['environment']),
      [],
    )).toBe(false);
    expect(hasReviewSensitivePluginUpdate(
      current,
      agentManifest(),
      [],
    )).toBe(false);
    expect(hasReviewSensitivePluginUpdate(
      agentManifest(['environment']),
      current,
      [],
    )).toBe(true);
  });

  it('canonicalizes local and explicit self-qualified Agent purpose service references', () => {
    const local = agentManifest(undefined, 'account');
    const selfQualified = agentManifest(undefined, {
      pluginId: 'acme.agent.consumer',
      localId: 'account',
    });
    const external = agentManifest(undefined, {
      pluginId: 'acme.accounts',
      localId: 'account',
    });

    expect(hasReviewSensitivePluginUpdate(local, selfQualified, [])).toBe(false);
    expect(hasReviewSensitivePluginUpdate(selfQualified, local, [])).toBe(false);
    expect(hasReviewSensitivePluginUpdate(local, external, [])).toBe(true);
    expect(hasReviewSensitivePluginUpdate(external, local, [])).toBe(true);
  });

  it('canonicalizes local and explicit self-qualified manual Connected Accounts service references', () => {
    const local = manifest(undefined, 'account');
    const selfQualified = manifest(undefined, {
      pluginId: 'acme.consumer',
      localId: 'account',
    });
    const external = manifest(undefined, {
      pluginId: 'acme.accounts',
      localId: 'account',
    });
    const granted = [upstreamSelection()];

    expect(hasReviewSensitivePluginUpdate(local, selfQualified, granted)).toBe(false);
    expect(hasReviewSensitivePluginUpdate(selfQualified, local, granted)).toBe(false);
    expect(hasReviewSensitivePluginUpdate(local, external, granted)).toBe(true);
    expect(hasReviewSensitivePluginUpdate(external, local, granted)).toBe(false);
  });

  it('canonicalizes local and explicit self-qualified Connected Account network origins', () => {
    const local = networkManifest('account');
    const selfQualified = networkManifest({
      pluginId: 'acme.consumer',
      localId: 'account',
    });
    const external = networkManifest({
      pluginId: 'acme.accounts',
      localId: 'account',
    });

    expect(hasReviewSensitivePluginUpdate(local, selfQualified, [])).toBe(false);
    expect(hasReviewSensitivePluginUpdate(selfQualified, local, [])).toBe(false);
    expect(hasReviewSensitivePluginUpdate(local, external, [])).toBe(true);
    expect(hasReviewSensitivePluginUpdate(external, local, [])).toBe(true);
  });

  it('treats acquired network.client private-network intent as an authority expansion', () => {
    const defaultIntent = networkClientManifest();
    const privateIntent = networkClientManifest(true);

    expect(hasReviewSensitivePluginUpdate(defaultIntent, defaultIntent, [])).toBe(false);
    expect(hasReviewSensitivePluginUpdate(defaultIntent, privateIntent, [])).toBe(true);
    expect(hasReviewSensitivePluginUpdate(privateIntent, defaultIntent, [])).toBe(false);
  });

  it('requires review when an existing request interceptor widens its declared policy', () => {
    const current = interceptorManifest([{
      id: 'protect-api',
      origins: ['https://api.example.test'],
      methods: ['GET'],
    }]);
    const widened = interceptorManifest([{
      id: 'protect-api',
      origins: ['https://api.example.test', 'https://accounts.example.test'],
      methods: ['GET', 'POST'],
    }]);

    expect(hasReviewSensitivePluginUpdate(current, current, [])).toBe(false);
    expect(hasReviewSensitivePluginUpdate(current, widened, [])).toBe(true);
    expect(hasReviewSensitivePluginUpdate(widened, current, [])).toBe(false);
  });
});
