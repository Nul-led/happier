import { describe, expect, it } from 'vitest';
import { RunnerRuntimeBootstrapV1Schema } from './bootstrap.js';

import {
  RunnerConnectedServiceReviewBindingsV1Schema,
} from './runnerConnectedServices.js';

const account = {
  service: { pluginId: 'acme.agent', localId: 'cloud' },
  accountId: 'work',
} as const;

describe('Runner Connected Service custody', () => {
  it('rejects direct Account credentials in an otherwise valid runtime bootstrap', () => {
    const bootstrap = {
      v: 1, purpose: 'happier.ephemeral-session-runner.runtime',
      homeServerIdentityId: 'home-1', activationId: '00000000-0000-4000-8000-000000000001',
      creatorAccountId: 'account-1', sessionId: 'session-1', machineId: 'machine-1',
      installationId: 'installation-1', launchManifestCommitment: 'A'.repeat(43),
      storedContent: { mode: 'plain' }, machineContent: { mode: 'plain' },
    };
    expect(RunnerRuntimeBootstrapV1Schema.safeParse(bootstrap).success).toBe(true);
    expect(RunnerRuntimeBootstrapV1Schema.safeParse({
      ...bootstrap,
      connectedServices: { v: 1, bindings: [{
        serviceKey: 'acme.agent/cloud', selection: { kind: 'profile', profileId: 'work' }, account,
        credentialRevision: 'csr_0123456789ABCDEFGHJKMNPQRS', configurationRevision: null,
        authenticationModeId: 'token',
        material: { credential: { v: 1, values: { token: 'account-secret' } }, configuration: null },
      }] },
    }).success).toBe(false);
  });
  it('rejects a secret-bearing review sidecar and duplicate services', () => {
    const binding = {
      serviceKey: 'acme.agent/cloud',
      selection: { kind: 'profile', profileId: 'work' },
      account,
      credentialRevision: 'csr_0123456789ABCDEFGHJKMNPQRS',
      configurationRevision: null,
      authenticationModeId: 'token',
    } as const;
    expect(RunnerConnectedServiceReviewBindingsV1Schema.safeParse({
      v: 1,
      bindings: [{ ...binding, material: { token: 'nope' } }],
    }).success).toBe(false);
    expect(RunnerConnectedServiceReviewBindingsV1Schema.safeParse({
      v: 1,
      bindings: [binding, binding],
    }).success).toBe(false);
  });
});
