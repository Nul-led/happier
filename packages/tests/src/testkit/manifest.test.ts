import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredRuntimeSecretValues,
  REDACTED_SECRET_PLACEHOLDER,
  registerRuntimeSecretValues,
} from './artifactSecretSafety';
import {
  CredentialShapedManifestFieldError,
  sanitizeDaemonRunnerContinuityManifestEvidence,
  writeTestManifest,
  type DaemonRunnerContinuityManifestEvidence,
} from './manifest';

describe('writeTestManifest', () => {
  it('persists extended stress topology and scenario metadata in the canonical manifest', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'happier-manifest-'));
    const daemonRunnerContinuity = {
      phaseCount: 3,
      runtime: {
        launchEntrypointKind: 'source',
        identityKind: 'mutable_runtime',
        entrypointIdentityFingerprints: {
          a: `sha256:${'a'.repeat(64)}`,
          b: `sha256:${'a'.repeat(64)}`,
          c: `sha256:${'a'.repeat(64)}`,
        },
        distinctEntrypointIdentityCount: 1,
        stableAcrossAllPhases: true,
      },
      daemon: {
        identityFingerprints: {
          a: `sha256:${'0'.repeat(64)}`,
          b: `sha256:${'1'.repeat(64)}`,
          c: `sha256:${'2'.repeat(64)}`,
        },
        distinctIdentityCount: 3,
        replacedAcrossAllPhases: true,
      },
      runner: {
        identityFingerprints: {
          a: `sha256:${'3'.repeat(64)}`,
          b: `sha256:${'3'.repeat(64)}`,
          c: `sha256:${'3'.repeat(64)}`,
        },
        processCommandHashFingerprints: {
          a: `sha256:${'b'.repeat(64)}`,
          b: `sha256:${'b'.repeat(64)}`,
          c: `sha256:${'b'.repeat(64)}`,
        },
        distinctIdentityCount: 1,
        distinctProcessCommandHashCount: 1,
        aliveAcrossAllPhases: true,
      },
      logicalSession: {
        identityFingerprints: {
          a: `sha256:${'4'.repeat(64)}`,
          b: `sha256:${'4'.repeat(64)}`,
          c: `sha256:${'4'.repeat(64)}`,
        },
        distinctIdentityCount: 1,
        stableAcrossAllPhases: true,
      },
      executionAuthority: {
        retainedAgentBindingFingerprints: {
          a: `sha256:${'5'.repeat(64)}`,
          b: `sha256:${'5'.repeat(64)}`,
          c: `sha256:${'5'.repeat(64)}`,
        },
        distinctRetainedAgentBindingCount: 1,
        stableAcrossAllPhases: true,
      },
      underlyingAgent: {
        childProcess: {
          availability: 'observed',
          identityFingerprints: {
            a: `sha256:${'f'.repeat(64)}`,
            b: `sha256:${'f'.repeat(64)}`,
            c: `sha256:${'f'.repeat(64)}`,
          },
          distinctIdentityCount: 1,
          stableAcrossAllPhases: true,
        },
        vendorSession: {
          availability: 'unknown',
          identityFingerprints: { a: null, b: null, c: null },
          distinctIdentityCount: null,
          stableAcrossAllPhases: null,
        },
      },
      authority: {
        capabilityFingerprints: {
          a: `sha256:${'9'.repeat(64)}`,
          b: `sha256:${'a'.repeat(64)}`,
          c: `sha256:${'b'.repeat(64)}`,
        },
        distinctCapabilityCount: 3,
        rotatedAcrossAllPhases: true,
        currentAcceptedAcrossAllPhases: true,
        predecessorRejectedAtBAndC: true,
      },
      turns: {
        completedTurnFingerprints: {
          a: `sha256:${'c'.repeat(64)}`,
          b: `sha256:${'d'.repeat(64)}`,
          c: `sha256:${'e'.repeat(64)}`,
        },
        distinctCompletedTurnCount: 3,
        matchingAssistantTranscriptOutputCounts: { b: 1, c: 1 },
        matchingEffectCounts: { b: 1, c: 1 },
        terminalEventCounts: { b: 1, c: 1 },
        activeTurnCrossedAToB: true,
        activeTurnCrossedBToC: true,
        exactlyOneMatchingAssistantTranscriptOutputPerLaterPhase: true,
        exactlyOneMatchingEffectPerLaterPhase: true,
        exactlyOneTerminalEventPerLaterPhase: true,
      },
      retainedPluginLifecycle: {
        agent: {
          generations: {
            retainedSessionBeforeUpdate: 'agent-generation-g',
            retainedSessionAfterUpdate: 'agent-generation-g',
            newSessionAfterUpdate: 'agent-generation-h',
          },
          distinctGenerationCount: 2,
          retainedLaterTurn: 'completed',
          newSessionFirstTurn: 'completed',
        },
        provider: {
          generations: {
            retainedHandleBeforeUpdate: 'provider-generation-p',
            retainedHandleAfterUpdate: 'provider-generation-p',
            newClaimAfterUpdate: 'provider-generation-q',
          },
          distinctGenerationCount: 2,
          retainedHandleUse: 'continued',
          newClaim: 'admitted',
        },
      },
    } satisfies DaemonRunnerContinuityManifestEvidence;
    const manifestPath = writeTestManifest(testDir, {
      startedAt: '2026-04-18T12:00:00.000Z',
      testName: 'stress-rpc',
      sessionIds: ['private-session-id'],
      targetMode: 'full-compose',
      topology: {
        kind: 'full-compose',
        composeProjectName: 'stress-project',
        services: ['postgres', 'redis', 'minio', 'minio-init', 'api', 'worker', 'gateway'],
        expectedApiReplicas: 3,
        expectedWorkerReplicas: 2,
        resolvedApiReplicas: 3,
        resolvedWorkerReplicas: 2,
        baseUrl: 'http://127.0.0.1:43080',
        ports: {
          gateway: 43080,
          postgres: 45432,
        },
      },
      scenario: {
        name: 'rpc.multiReplica',
        resolvedConfig: {
          targetMode: 'full-compose',
        },
      },
      artifacts: {
        composeFile: '/tmp/compose.yml',
        gatewayConfigFile: '/tmp/nginx.conf',
        summaryFile: '/tmp/summary.json',
      },
      results: {
        status: 'passed',
        startedAt: '2026-04-18T12:00:00.000Z',
        endedAt: '2026-04-18T12:05:00.000Z',
        failureClassification: 'none',
        daemonRunnerContinuity,
      },
    });

    const written = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

    expect(written.targetMode).toBe('full-compose');
    expect(written.topology).toMatchObject({
      kind: 'full-compose',
      composeProjectName: 'stress-project',
      expectedApiReplicas: 3,
      resolvedWorkerReplicas: 2,
    });
    expect(written.scenario).toMatchObject({ name: 'rpc.multiReplica' });
    expect(written.artifacts).toMatchObject({ composeFile: '/tmp/compose.yml' });
    expect(written.sessionIds).toEqual(['private-session-id']);
    expect(written.results).toMatchObject({
      status: 'passed',
      failureClassification: 'none',
      daemonRunnerContinuity: {
        phaseCount: 3,
        runtime: {
          launchEntrypointKind: 'source',
          identityKind: 'mutable_runtime',
          distinctEntrypointIdentityCount: 1,
          stableAcrossAllPhases: true,
        },
        daemon: {
          distinctIdentityCount: 3,
          replacedAcrossAllPhases: true,
        },
        runner: {
          distinctIdentityCount: 1,
          distinctProcessCommandHashCount: 1,
          aliveAcrossAllPhases: true,
        },
        authority: {
          distinctCapabilityCount: 3,
          rotatedAcrossAllPhases: true,
        },
        retainedPluginLifecycle: {
          agent: {
            generations: {
              retainedSessionBeforeUpdate: 'agent-generation-g',
              retainedSessionAfterUpdate: 'agent-generation-g',
              newSessionAfterUpdate: 'agent-generation-h',
            },
            distinctGenerationCount: 2,
            retainedLaterTurn: 'completed',
            newSessionFirstTurn: 'completed',
          },
          provider: {
            generations: {
              retainedHandleBeforeUpdate: 'provider-generation-p',
              retainedHandleAfterUpdate: 'provider-generation-p',
              newClaimAfterUpdate: 'provider-generation-q',
            },
            distinctGenerationCount: 2,
            retainedHandleUse: 'continued',
            newClaim: 'admitted',
          },
        },
      },
    });
    const serializedContinuity = JSON.stringify(
      (written.results as { daemonRunnerContinuity?: unknown }).daemonRunnerContinuity,
    );
    expect(serializedContinuity).not.toContain('private-session-id');

    expect(sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      runtime: {
        ...daemonRunnerContinuity.runtime,
        launchEntrypointKind: 'candidate_artifact',
        identityKind: 'immutable_snapshot',
      },
    })).toMatchObject({
      runtime: {
        launchEntrypointKind: 'candidate_artifact',
        identityKind: 'immutable_snapshot',
      },
    });
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      runtime: {
        ...daemonRunnerContinuity.runtime,
        launchEntrypointKind: 'candidate_artifact',
        identityKind: 'mutable_runtime',
      },
    })).toThrow(/evidence contract/u);
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      runtime: {
        ...daemonRunnerContinuity.runtime,
        launchEntrypointKind: 'candidate_artifact',
        identityKind: 'unclassified',
      },
    })).toThrow(/evidence contract/u);
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      runtime: {
        ...daemonRunnerContinuity.runtime,
        launchEntrypointKind: 'candidate_artifact',
        identityKind: 'immutable_snapshot',
      },
      underlyingAgent: {
        ...daemonRunnerContinuity.underlyingAgent,
        childProcess: {
          availability: 'unknown',
          identityFingerprints: { a: null, b: null, c: null },
          distinctIdentityCount: null,
          stableAcrossAllPhases: null,
        },
      },
    })).toThrow(/evidence contract/u);

    const evidenceWithUnknownFields = [
      {
        label: 'root',
        evidence: { ...daemonRunnerContinuity, rawAuthorityPath: '/private/authority.json' },
      },
      {
        label: 'daemon',
        evidence: {
          ...daemonRunnerContinuity,
          daemon: { ...daemonRunnerContinuity.daemon, rawPid: 51_001 },
        },
      },
      {
        label: 'runtime',
        evidence: {
          ...daemonRunnerContinuity,
          runtime: { ...daemonRunnerContinuity.runtime, rawEntrypoint: '/private/source' },
        },
      },
      {
        label: 'runner',
        evidence: {
          ...daemonRunnerContinuity,
          runner: { ...daemonRunnerContinuity.runner, rawPath: '/private/runner' },
        },
      },
      {
        label: 'logical session',
        evidence: {
          ...daemonRunnerContinuity,
          logicalSession: {
            ...daemonRunnerContinuity.logicalSession,
            rawSessionId: 'private-session-id',
          },
        },
      },
      {
        label: 'execution authority',
        evidence: {
          ...daemonRunnerContinuity,
          executionAuthority: {
            ...daemonRunnerContinuity.executionAuthority,
            rawBinding: 'private-agent-binding',
          },
        },
      },
      {
        label: 'authority',
        evidence: {
          ...daemonRunnerContinuity,
          authority: { ...daemonRunnerContinuity.authority, rawCapability: 'private-capability' },
        },
      },
      {
        label: 'underlying Agent child process',
        evidence: {
          ...daemonRunnerContinuity,
          underlyingAgent: {
            ...daemonRunnerContinuity.underlyingAgent,
            childProcess: {
              ...daemonRunnerContinuity.underlyingAgent.childProcess,
              rawPid: 51_002,
            },
          },
        },
      },
      {
        label: 'turns',
        evidence: {
          ...daemonRunnerContinuity,
          turns: { ...daemonRunnerContinuity.turns, rawTurnId: 'private-turn-id' },
        },
      },
      {
        label: 'phase fingerprints',
        evidence: {
          ...daemonRunnerContinuity,
          daemon: {
            ...daemonRunnerContinuity.daemon,
            identityFingerprints: {
              ...daemonRunnerContinuity.daemon.identityFingerprints,
              rawFingerprint: `sha256:${'f'.repeat(64)}`,
            },
          },
        },
      },
      {
        label: 'later-phase counts',
        evidence: {
          ...daemonRunnerContinuity,
          turns: {
            ...daemonRunnerContinuity.turns,
            matchingAssistantTranscriptOutputCounts: {
              ...daemonRunnerContinuity.turns.matchingAssistantTranscriptOutputCounts,
              a: 0,
            },
          },
        },
      },
      {
        label: 'retained plugin lifecycle',
        evidence: {
          ...daemonRunnerContinuity,
          retainedPluginLifecycle: {
            ...daemonRunnerContinuity.retainedPluginLifecycle,
            rawGenerationId: 'private-generation-id',
          },
        },
      },
      {
        label: 'retained plugin lifecycle generations',
        evidence: {
          ...daemonRunnerContinuity,
          retainedPluginLifecycle: {
            ...daemonRunnerContinuity.retainedPluginLifecycle,
            agent: {
              ...daemonRunnerContinuity.retainedPluginLifecycle.agent,
              generations: {
                ...daemonRunnerContinuity.retainedPluginLifecycle.agent.generations,
                rawGenerationId: 'private-generation-id',
              },
            },
          },
        },
      },
    ] as const;
    for (const { label, evidence } of evidenceWithUnknownFields) {
      expect(
        () => sanitizeDaemonRunnerContinuityManifestEvidence(evidence),
        label,
      ).toThrow(/exact keys/u);
    }
    expect(() => writeTestManifest(testDir, {
      startedAt: '2026-04-18T12:00:00.000Z',
      sessionIds: ['private-session-id'],
      results: {
        status: 'failed',
        startedAt: '2026-04-18T12:00:00.000Z',
        daemonRunnerContinuity: evidenceWithUnknownFields[0].evidence,
      },
    })).toThrow(/exact keys/u);
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      runner: {
        ...daemonRunnerContinuity.runner,
        identityFingerprints: {
          a: '/private/not-a-fingerprint',
          b: '/private/not-a-fingerprint',
          c: '/private/not-a-fingerprint',
        },
      },
    })).toThrow(/SHA-256 fingerprint/u);
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      runtime: {
        ...daemonRunnerContinuity.runtime,
        launchEntrypointKind: 'private_path' as never,
      },
    })).toThrow(/evidence contract/u);
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      runtime: {
        ...daemonRunnerContinuity.runtime,
        identityKind: 'versioned_runtime',
      },
    })).toThrow(/evidence contract/u);
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      daemon: {
        ...daemonRunnerContinuity.daemon,
        identityFingerprints: {
          ...daemonRunnerContinuity.daemon.identityFingerprints,
          b: daemonRunnerContinuity.daemon.identityFingerprints.a,
        },
      },
    })).toThrow(/evidence contract/u);
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      underlyingAgent: {
        ...daemonRunnerContinuity.underlyingAgent,
        vendorSession: {
          availability: 'unknown',
          identityFingerprints: {
            a: `sha256:${'f'.repeat(64)}`,
            b: null,
            c: null,
          },
          distinctIdentityCount: null,
          stableAcrossAllPhases: null,
        },
      },
    })).toThrow(/evidence contract/u);
    expect(() => sanitizeDaemonRunnerContinuityManifestEvidence({
      ...daemonRunnerContinuity,
      retainedPluginLifecycle: {
        ...daemonRunnerContinuity.retainedPluginLifecycle,
        agent: {
          ...daemonRunnerContinuity.retainedPluginLifecycle.agent,
          generations: {
            ...daemonRunnerContinuity.retainedPluginLifecycle.agent.generations,
            newSessionAfterUpdate:
              daemonRunnerContinuity.retainedPluginLifecycle.agent.generations
                .retainedSessionBeforeUpdate,
          },
        },
      },
    })).toThrow(/distinct retained plugin lifecycle generation/u);
  });
});

describe('writeTestManifest secret safety', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'happier-manifest-secrets-'));
    clearRegisteredRuntimeSecretValues();
  });

  afterEach(() => {
    clearRegisteredRuntimeSecretValues();
  });

  it('redacts credential-shaped env values while keeping the rest of the env record useful', () => {
    const manifestPath = writeTestManifest(testDir, {
      startedAt: '2026-08-30T12:00:00.000Z',
      env: {
        CI: '1',
        HAPPIER_STRESS_USERS: '25',
        HANDY_MASTER_SECRET: 'sentinel-master-secret-0123456789abcdef',
        S3_SECRET_KEY: 'sentinel-minio-secret-0123456789abcdef',
      },
    });

    const raw = readFileSync(manifestPath, 'utf8');
    expect(raw).not.toContain('sentinel-master-secret-0123456789abcdef');
    expect(raw).not.toContain('sentinel-minio-secret-0123456789abcdef');
    const written = JSON.parse(raw) as { env: Record<string, string> };
    expect(written.env.CI).toBe('1');
    expect(written.env.HAPPIER_STRESS_USERS).toBe('25');
    expect(written.env.HANDY_MASTER_SECRET).toBe(REDACTED_SECRET_PLACEHOLDER);
    expect(written.env.S3_SECRET_KEY).toBe(REDACTED_SECRET_PLACEHOLDER);
  });

  it('fails closed when a caller puts credential-shaped fields outside the env record', () => {
    expect(() => writeTestManifest(testDir, {
      startedAt: '2026-08-30T12:00:00.000Z',
      expected: { masterSecret: 'sentinel-master-secret-0123456789abcdef' },
    })).toThrow(CredentialShapedManifestFieldError);
    expect(() => writeTestManifest(testDir, {
      startedAt: '2026-08-30T12:00:00.000Z',
      scenario: {
        name: 'leaky',
        resolvedConfig: { credentials: { postgresPassword: 'sentinel-pg-0123456789abcdef' } },
      },
    })).toThrow(/scenario.resolvedConfig.credentials.postgresPassword/u);
    expect(existsSync(join(testDir, 'manifest.json'))).toBe(false);
  });

  it('scrubs registered runtime secret values from every manifest string', () => {
    registerRuntimeSecretValues('sentinel-route-grant-seed-0123456789');

    const manifestPath = writeTestManifest(testDir, {
      startedAt: '2026-08-30T12:00:00.000Z',
      observed: {
        note: 'route grant seed leaked: sentinel-route-grant-seed-0123456789',
      },
    });

    const raw = readFileSync(manifestPath, 'utf8');
    expect(raw).not.toContain('sentinel-route-grant-seed-0123456789');
    expect(raw).toContain(`route grant seed leaked: ${REDACTED_SECRET_PLACEHOLDER}`);
  });

  it('redacts unregistered credentials embedded in free-form manifest strings', () => {
    const bearer = 'sentinel-manifest-bearer-0123456789abcdef';
    const password = 'sentinel-manifest-password-0123456789abcdef';
    const manifestPath = writeTestManifest(testDir, {
      startedAt: '2026-08-30T12:00:00.000Z',
      observed: {
        note: `Authorization: Bearer ${bearer}`,
        endpoint: `https://operator:${password}@example.test/path`,
      },
    });

    const raw = readFileSync(manifestPath, 'utf8');
    expect(raw).not.toContain(bearer);
    expect(raw).not.toContain(password);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('never treats benign secret_link values or reason codes as credentials', () => {
    const manifestPath = writeTestManifest(testDir, {
      startedAt: '2026-08-30T12:00:00.000Z',
      observed: {
        exposure: { mode: 'secret_link' },
        code: 'secret_link_mode_unavailable',
      },
    });

    const written = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      observed: { exposure: { mode: string }; code: string };
    };
    expect(written.observed.exposure.mode).toBe('secret_link');
    expect(written.observed.code).toBe('secret_link_mode_unavailable');
  });

  it('keeps numeric seed fields while rejecting string-valued seed material', () => {
    const manifestPath = writeTestManifest(testDir, {
      startedAt: '2026-08-30T12:00:00.000Z',
      seed: 42,
    });
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).seed).toBe(42);

    expect(() => writeTestManifest(testDir, {
      startedAt: '2026-08-30T12:00:00.000Z',
      expected: { signingSeed: 'sentinel-signing-seed-0123456789ab' },
    })).toThrow(CredentialShapedManifestFieldError);
  });
});
