import { afterEach, describe, expect, it } from 'vitest';

import {
    DEFAULT_BUG_REPORTS_CAPABILITIES,
    FEATURE_IDS,
    getFeatureRepresentation,
    readServerEnabledBit,
    type FeatureId,
} from '@happier-dev/protocol';
import type { FeaturesPayloadDelta } from './types';
import { featuresSchema } from './types';
import { resolveServerFeaturePayload } from './catalog/resolveServerFeaturePayload';
import { isResolvedServerFeatureEnabledForGating } from './catalog/serverFeatureGate';
import { serverFeatureRegistry } from './catalog/serverFeatureRegistry';
import { readSessionBoardFeatureEnv } from './catalog/readFeatureEnv';
import { resolveSetupSurfacePolicyFeature } from './setupSurfacePolicyFeature';
import {
    initializeSessionSystemRecordsProtocolV1Activation,
    resetSessionSystemRecordsProtocolV1ActivationForTests,
    SESSION_SYSTEM_RECORDS_CONTRACT_MIGRATION,
} from '@/app/session/systemRecords/sessionSystemRecordProtocolContract';

function readProducedEnabledBit(delta: FeaturesPayloadDelta, featureId: FeatureId): boolean | undefined {
    let current: unknown = delta.features;
    for (const segment of featureId.split('.')) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const enabled = (current as Record<string, unknown>).enabled;
    return typeof enabled === 'boolean' ? enabled : undefined;
}

describe('features/serverFeatureRegistry', () => {
    afterEach(() => resetSessionSystemRecordsProtocolV1ActivationForTests());

    it('assigns every server-represented catalog feature to exactly one registry or fixed-policy resolver', () => {
        const featureProducers = [
            () => resolveSetupSurfacePolicyFeature(),
            ...serverFeatureRegistry,
        ] as const;
        const failures = FEATURE_IDS
            .filter((featureId) => getFeatureRepresentation(featureId) === 'server')
            .map((featureId) => ({
                featureId,
                producerCount: featureProducers.filter(
                    (resolver) => readProducedEnabledBit(resolver({}), featureId) !== undefined,
                ).length,
            }))
            .filter(({ producerCount }) => producerCount !== 1);

        expect(failures).toEqual([]);
    });

    it('keeps collaboration closed until explicitly enabled and enforces its sharing dependency', () => {
        const disabled = resolveServerFeaturePayload({}, serverFeatureRegistry);
        const enabled = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED: '1',
        }, serverFeatureRegistry);
        const sharingDisabled = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED: '1',
            HAPPIER_BUILD_FEATURES_DENY: 'sharing.session',
        }, serverFeatureRegistry);
        const teamsDisabled = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED: '1',
            HAPPIER_FEATURE_TEAMS__ENABLED: '0',
        }, serverFeatureRegistry);
        expect(readServerEnabledBit(teamsDisabled, 'sessions.collaboration')).toBe(true);
        expect(readServerEnabledBit(disabled, 'sessions.collaboration')).toBe(false);
        expect(readServerEnabledBit(enabled, 'sessions.collaboration')).toBe(true);
        expect(readServerEnabledBit(sharingDisabled, 'sessions.collaboration')).toBe(false);
    });

    it('keeps conversations closed until explicitly enabled and enforces the collaboration dependency', () => {
        const disabled = resolveServerFeaturePayload({}, serverFeatureRegistry);
        const enabled = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED: '1',
            HAPPIER_FEATURE_SESSIONS_CONVERSATIONS__ENABLED: '1',
        }, serverFeatureRegistry);
        const missingDependency = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_CONVERSATIONS__ENABLED: '1',
        }, serverFeatureRegistry);
        const malformedDependency = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED: 'not-a-boolean',
            HAPPIER_FEATURE_SESSIONS_CONVERSATIONS__ENABLED: '1',
        }, serverFeatureRegistry);
        const malformedConversations = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED: '1',
            HAPPIER_FEATURE_SESSIONS_CONVERSATIONS__ENABLED: 'not-a-boolean',
        }, serverFeatureRegistry);

        expect(readServerEnabledBit(disabled, 'sessions.conversations')).toBe(false);
        expect(readServerEnabledBit(enabled, 'sessions.conversations')).toBe(true);
        expect(readServerEnabledBit(missingDependency, 'sessions.conversations')).toBe(false);
        expect(readServerEnabledBit(malformedDependency, 'sessions.conversations')).toBe(false);
        expect(readServerEnabledBit(malformedConversations, 'sessions.conversations')).toBe(false);
    });

    it('keeps Following fail-closed independently of its diagnostic protocol capability', () => {
        const disabled = resolveServerFeaturePayload({}, serverFeatureRegistry);
        const enabled = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: '1',
        }, serverFeatureRegistry);
        const malformed = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: 'not-a-boolean',
        }, serverFeatureRegistry);
        const sessionsDenied = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: '1',
            HAPPIER_BUILD_FEATURES_DENY: 'sessions',
        }, serverFeatureRegistry);

        expect(disabled.capabilities.session.follow).toEqual({ contextVersion: 1 });
        expect(readServerEnabledBit(disabled, 'sessions.following')).toBe(false);
        expect(readServerEnabledBit(enabled, 'sessions.following')).toBe(true);
        expect(readServerEnabledBit(malformed, 'sessions.following')).toBe(false);
        expect(readServerEnabledBit(sessionsDenied, 'sessions.following')).toBe(false);
    });

    it('keeps Session Board closed until explicitly enabled', () => {
        const disabled = resolveServerFeaturePayload({}, serverFeatureRegistry);
        const enabled = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_BOARD__ENABLED: '1',
        }, serverFeatureRegistry);
        const malformed = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_BOARD__ENABLED: 'not-a-boolean',
        }, serverFeatureRegistry);

        expect(readServerEnabledBit(disabled, 'sessions.board')).toBe(false);
        expect(readSessionBoardFeatureEnv({}).enabled).toBe(false);
        expect(readSessionBoardFeatureEnv({ HAPPIER_FEATURE_SESSIONS_BOARD__ENABLED: '1' }).enabled).toBe(true);
        expect(readServerEnabledBit(enabled, 'sessions.board')).toBe(false);
        expect(readServerEnabledBit(malformed, 'sessions.board')).toBe(false);
    });

    it('publishes Session Board only when the operator enables it and System Records v1 is active', async () => {
        await initializeSessionSystemRecordsProtocolV1Activation({
            $queryRawUnsafe: async () => [{ migration_name: SESSION_SYSTEM_RECORDS_CONTRACT_MIGRATION }],
            sessionSystemRecord: {
                findMany: async () => [],
            },
        } as never);

        const enabled = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_BOARD__ENABLED: '1',
        }, serverFeatureRegistry);
        const buildDenied = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_BOARD__ENABLED: '1',
            HAPPIER_BUILD_FEATURES_DENY: 'sessions.board',
        }, serverFeatureRegistry);
        // The catalog owns the dependency closure: an explicitly enabled Board on a
        // Home without Sessions is still closed, and no call site reconstructs that.
        const dependencyDenied = resolveServerFeaturePayload({
            HAPPIER_FEATURE_SESSIONS_BOARD__ENABLED: '1',
            HAPPIER_BUILD_FEATURES_DENY: 'sessions',
        }, serverFeatureRegistry);

        expect(readServerEnabledBit(enabled, 'sessions.board')).toBe(true);
        expect(readServerEnabledBit(buildDenied, 'sessions.board')).toBe(false);
        expect(readServerEnabledBit(dependencyDenied, 'sessions.board')).toBe(false);
    });

    it('enables Teams by default and honors operator and build-policy opt-outs', () => {
        const enabled = resolveServerFeaturePayload({}, serverFeatureRegistry);
        const operatorDisabled = resolveServerFeaturePayload({
            HAPPIER_FEATURE_TEAMS__ENABLED: '0',
        }, serverFeatureRegistry);
        const buildDisabled = resolveServerFeaturePayload({
            HAPPIER_BUILD_FEATURES_DENY: 'teams',
        }, serverFeatureRegistry);

        expect(readServerEnabledBit(enabled, 'teams')).toBe(true);
        expect(readServerEnabledBit(operatorDisabled, 'teams')).toBe(false);
        expect(readServerEnabledBit(buildDisabled, 'teams')).toBe(false);
    });

    it('denies Teams when its server projection is missing', () => {
        const missing = resolveServerFeaturePayload({}, [() => ({ features: {} })]);

        expect(readServerEnabledBit(missing, 'teams')).toBe(false);
    });

    it('provides at least one feature resolver', () => {
        expect(serverFeatureRegistry.length).toBeGreaterThan(0);
    });

    it('returns a schema-valid /v1/features payload', () => {
        const res = resolveServerFeaturePayload({} as NodeJS.ProcessEnv, serverFeatureRegistry);
        const parsed = featuresSchema.safeParse(res);
        expect(parsed.success).toBe(true);
    });

    it('publishes terminal byte-stream as a represented server feature', () => {
        const res = resolveServerFeaturePayload({} as NodeJS.ProcessEnv, serverFeatureRegistry);

        expect(readServerEnabledBit(res, 'terminal.embeddedPty')).toBe(true);
        expect(readServerEnabledBit(res, 'terminal.transport.byteStream')).toBe(true);
    });

    it('keeps current gate reads stable when a resolver emits newer unknown fields and malformed bugReports capabilities', () => {
        const res = resolveServerFeaturePayload({} as NodeJS.ProcessEnv, [
            () =>
                ({
                    features: {
                        connectedServices: {
                            enabled: true,
                            quotas: { enabled: true },
                        },
                        futureBridge: {
                            enabled: true,
                        },
                    },
                    capabilities: {
                        bugReports: {
                            providerUrl: 'not-a-url',
                            defaultIncludeDiagnostics: false,
                            maxArtifactBytes: 0,
                            acceptedArtifactKinds: [],
                            uploadTimeoutMs: 0,
                            contextWindowMs: 0,
                        },
                        futureCapability: {
                            enabled: true,
                        },
                    },
                }) as any,
        ]);

        expect(featuresSchema.safeParse(res).success).toBe(true);
        expect(res.features.connectedServices.enabled).toBe(true);
        expect(readServerEnabledBit(res, 'connectedServices.quotas')).toBe(true);
        expect(res.capabilities.bugReports).toEqual(DEFAULT_BUG_REPORTS_CAPABILITIES);
        expect((res as any).features.futureBridge).toBeUndefined();
        expect((res as any).capabilities.futureCapability).toBeUndefined();
    });

    it('reads resolved server feature gates through the fail-closed helper', () => {
        const res = resolveServerFeaturePayload({
            HAPPIER_FEATURE_VOICE__ENABLED: '1',
            HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: '0',
            ELEVENLABS_API_KEY: 'el_key',
            ELEVENLABS_AGENT_ID: 'agent_dev',
        } as NodeJS.ProcessEnv, serverFeatureRegistry);

        expect(isResolvedServerFeatureEnabledForGating(res, 'voice.happierVoice')).toBe(true);
        expect(isResolvedServerFeatureEnabledForGating({ features: { voice: { happierVoice: { enabled: 'yes' } } } } as any, 'voice.happierVoice')).toBe(false);
    });

    it('throws when a resolver returns an invalid features shape', () => {
        expect(() =>
            resolveServerFeaturePayload({} as NodeJS.ProcessEnv, [
                () =>
                    ({
                        features: { voice: { enabled: 'nope' } },
                    }) as any,
            ]),
        ).toThrow(/features/i);
    });

    it('exposes Live Activity direct APNs diagnostics without APNs credential material', () => {
        const privateKey = '-----BEGIN PRIVATE KEY-----\nSECRET-PRIVATE-KEY\n-----END PRIVATE KEY-----';
        const res = resolveServerFeaturePayload({
            HAPPIER_LIVE_ACTIVITY_REMOTE_UPDATES_ENABLED: '1',
            HAPPIER_LIVE_ACTIVITY_REMOTE_UPDATE_MODE: 'direct_apns',
            HAPPIER_LIVE_ACTIVITY_APNS_TEAM_ID: 'TEAMID1234',
            HAPPIER_LIVE_ACTIVITY_APNS_PRIVATE_KEY: privateKey,
        } as NodeJS.ProcessEnv, serverFeatureRegistry);

        const directDiagnostics = res.capabilities.liveActivities.remoteUpdates.modes.direct_apns;
        expect(directDiagnostics.available).toBe(false);
        expect(directDiagnostics.configurationDiagnostics).toContain('apns_key_id_missing');
        expect(directDiagnostics.configurationDiagnostics).toContain('apns_bundle_id_allowlist_missing');
        expect(JSON.stringify(res)).not.toContain('SECRET-PRIVATE-KEY');
        expect(JSON.stringify(res)).not.toContain(privateKey);
    });
});
