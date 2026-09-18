import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
    DIRECT_ROUTE_GRANT_TTL_MS,
    ProviderConnectionIdSchema,
    type ProviderBrokerOpenRequestV1,
    type ProviderBrokerRequestAdmissionV1,
    type SignedProviderBrokerRouteGrantV1,
} from '@happier-dev/protocol';
import {
    computeTeamCredentialSourceMemberKeyV1,
    encodeSessionTeamCredentialSlotKeyV1,
} from '@happier-dev/protocol/teams';
import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import {
    PROVIDER_BROKER_ROUTE_GRANT_TTL_MS,
    admitTeamCredentialProviderBrokerRequest as admitTeamCredentialProviderBrokerRequestOwner,
    authorizeTeamCredentialProviderModelCatalog as authorizeTeamCredentialProviderModelCatalogOwner,
    openRunnerTeamCredentialProviderBroker as openRunnerTeamCredentialProviderBrokerOwner,
    openTeamCredentialProviderBroker as openTeamCredentialProviderBrokerOwner,
} from './providerBrokerAdmission';
import { admitSessionTeamCredentialBindingInTx } from './sessionBinding';
import { deleteMachinePool } from '@/app/machines/pools/machinePoolService';
import type { MachineDaemonPresenceSocketServer } from '@/app/machines/machineDaemonPresence';
import { DaemonProviderModelProjectionResponseV1Schema } from '@happier-dev/protocol/rpc';
import { selectMachinePoolCandidate } from '@/app/machines/pools/machinePoolPlacementService';
import { applySessionTurnMutation } from '@/app/session/sessionWriteService';

const TEST_AUTHENTICATION = {
    env: process.env,
    authority: 'present_user',
    authenticationEvidence: [],
} as const;

function providerSourceMemberKey(connectionId: string, credentialSlotId: string) {
    return computeTeamCredentialSourceMemberKeyV1({
        kind: 'provider_credential_slot',
        connectionId: ProviderConnectionIdSchema.parse(connectionId),
        credentialSlotId,
    });
}

type OpenInput = Parameters<typeof openTeamCredentialProviderBrokerOwner>[0];
type LegacyOpenInput = Omit<OpenInput, 'readCurrentPresence'>
    & Partial<Pick<OpenInput, 'readCurrentPresence'>>
    & Readonly<{
        initiatorPresence: import('@/app/machines/machineDaemonPresence').MachineDaemonPresenceInventory;
        brokerPresence: import('@/app/machines/machineDaemonPresence').MachineDaemonPresenceInventory;
    }>;

function withCurrentPresence<T extends LegacyOpenInput>(input: T) {
    return {
        ...input,
        readCurrentPresence: input.readCurrentPresence ?? (async () => ({
            initiatorPresence: input.initiatorPresence,
            brokerPresence: input.brokerPresence,
        })),
    };
}

function openTeamCredentialProviderBroker(input: LegacyOpenInput) {
    return openTeamCredentialProviderBrokerOwner(withCurrentPresence(input));
}

type RunnerOpenInput = Parameters<typeof openRunnerTeamCredentialProviderBrokerOwner>[0];
function openRunnerTeamCredentialProviderBroker(
    input: Omit<RunnerOpenInput, 'readCurrentPresence'>
        & Partial<Pick<RunnerOpenInput, 'readCurrentPresence'>>
        & Readonly<{
            initiatorPresence: import('@/app/machines/machineDaemonPresence').MachineDaemonPresenceInventory;
            brokerPresence: import('@/app/machines/machineDaemonPresence').MachineDaemonPresenceInventory;
        }>,
) {
    return openRunnerTeamCredentialProviderBrokerOwner(withCurrentPresence(input));
}

type CatalogInput = Parameters<typeof authorizeTeamCredentialProviderModelCatalogOwner>[0];
function authorizeTeamCredentialProviderModelCatalog(
    input: Omit<CatalogInput, 'readCurrentBrokerPresence'> & Partial<Pick<CatalogInput, 'readCurrentBrokerPresence'>> & Readonly<{
        brokerPresence: import('@/app/machines/machineDaemonPresence').MachineDaemonPresenceInventory;
    }>,
) {
    return authorizeTeamCredentialProviderModelCatalogOwner({
        ...input,
        readCurrentBrokerPresence: input.readCurrentBrokerPresence ?? (async () => input.brokerPresence),
    });
}

type RequestAdmissionInput = Parameters<typeof admitTeamCredentialProviderBrokerRequestOwner>[0];
function admitTeamCredentialProviderBrokerRequest(
    input: Omit<RequestAdmissionInput, 'readCurrentBrokerPresence'>
        & Partial<Pick<RequestAdmissionInput, 'readCurrentBrokerPresence'>>
        & Readonly<{ brokerPresence: import('@/app/machines/machineDaemonPresence').MachineDaemonPresenceInventory }>,
) {
    return admitTeamCredentialProviderBrokerRequestOwner({
        ...input,
        readCurrentBrokerPresence: input.readCurrentBrokerPresence ?? (async () => input.brokerPresence),
    });
}

describe('Team credential Provider broker admission', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: 'team-provider-broker-admission-',
            initAuth: false,
            env: {
                HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES__ENABLED: '1',
            },
        });
    }, 180_000);
    afterAll(async () => { await harness?.close(); });

    it('uses the native direct TCP tunnel admission window for new broker streams', () => {
        expect(PROVIDER_BROKER_ROUTE_GRANT_TTL_MS)
            .toBe(DIRECT_ROUTE_GRANT_TTL_MS.directTcpTunnel);
    });

    it('connects current Session, resource, source and exact Machines to one pre-forward usage admission', async () => {
        const requester = await db.account.create({ data: { encryptionMode: 'plain' } });
        const custodian = await db.account.create({ data: { encryptionMode: 'plain' } });
        const team = await db.team.create({ data: { name: 'Broker admission' } });
        const requesterMembership = await db.teamMembership.create({
            data: { teamId: team.id, accountId: requester.id, role: 'member' },
        });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: custodian.id, role: 'owner' } });
        const workerEndpointId = 'a'.repeat(64);
        const brokerEndpointId = 'b'.repeat(64);
        const worker = await db.machine.create({ data: {
            id: `worker-${requester.id}`, accountId: requester.id, metadata: '{}', kind: 'persistent', active: true,
            operationProtocolCapabilities: { irohMachineEndpoint: { protocolVersions: [1], endpointId: workerEndpointId } },
            operationProtocolCapabilitiesRevision: 1,
        } });
        const broker = await db.machine.create({ data: {
            id: `broker-${custodian.id}`, accountId: custodian.id, metadata: '{}', kind: 'persistent', active: true,
            operationProtocolCapabilities: {
                providerBrokerIngress: { protocolVersions: [1] },
                irohMachineEndpoint: { protocolVersions: [1], endpointId: brokerEndpointId },
            },
            operationProtocolCapabilitiesRevision: 1,
        } });
        const resource = await db.teamCredentialResource.create({ data: {
            teamId: team.id,
            custodianAccountId: custodian.id,
            displayName: 'Shared provider',
            enabled: true,
            revision: 1,
            disclosureCeiling: 'brokered_only',
            sessionUsePolicy: 'personal_allowed',
            sourceBindingJson: JSON.stringify({
                v: 1,
                kind: 'provider_connection',
                connectionId: 'connection-1',
                connectionSecurityFingerprint: 'connection-security:v1:1',
                credentialSlotId: 'apiKey',
            }),
            brokerMachineId: broker.id,
            memberGrants: { create: { teamMembershipId: requesterMembership.id, deliveryMode: 'brokered' } },
        } });
        const session = await db.session.create({ data: {
            id: `session-${requester.id}`,
            tag: `broker-${requester.id}`,
            accountId: requester.id,
            metadata: '{}',
            active: true,
            latestTurnId: 'turn-1',
            latestTurnStatus: 'in_progress',
        } });
        await db.accessKey.create({ data: {
            accountId: requester.id,
            machineId: worker.id,
            sessionId: session.id,
            data: '{}',
        } });
        await db.sessionTeamCredentialBinding.create({ data: {
            sessionId: session.id,
            slotKind: 'provider_model:brokered',
            slotKey: Buffer.from(encodeSessionTeamCredentialSlotKeyV1({ kind: 'provider_model' })),
            resourceId: resource.id,
            resourceRevision: resource.revision,
        } });
        await expect(applySessionTurnMutation({
            actorUserId: requester.id,
            authentication: TEST_AUTHENTICATION,
            mutation: {
                v: 1,
                sessionId: session.id,
                mutationId: 'begin-turn-1',
                turnId: 'turn-1',
                action: 'begin',
                observedAt: 1,
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });

        const canonicalApplication = {
            agentTargetKey: 'agent:happier.agent.codex/codex',
            implementationIdentity: { pluginId: 'happier.provider.cliproxyapi', localId: 'cliproxyapi' },
            endpointTemplateId: 'openai-responses',
            protocol: 'openai-responses',
        } as const;
        const projection = (stale = false) => ({
            status: 'success',
            agentTargetKey: canonicalApplication.agentTargetKey,
            groups: [{
                connectionId: 'connection-1', providerName: 'CLIProxyAPI', connectionName: 'Work',
                connectionRole: 'named', connectionDisplayNameMode: 'custom', connectionRevision: 1,
                sourceAuthority: {
                    provider: { identity: canonicalApplication.implementationIdentity, definitionRevision: 1 },
                    connectionSecurityFingerprint: 'connection-security:v1:1',
                },
                sourceRevision: 'source-revision-1', modelLoadAction: 'available', modelLoadPreflightPolicy: null,
                authorization: { authorized: true }, manualModelPolicy: 'allowed',
                supportsFreeformModelIds: false, suppressedConnectedServiceIds: [],
                rows: [{
                    ref: { agentTargetKey: canonicalApplication.agentTargetKey, providerConnectionId: 'connection-1', modelId: 'model-1' },
                    descriptor: { id: 'model-1', name: 'Model 1' }, application: canonicalApplication,
                    sources: { manual: false, static: true, probe: false }, confidence: 'verified_static',
                    compatibility: {
                        result: { status: 'verified', selectedProtocol: canonicalApplication.protocol, evidence: { sourceUrls: ['https://example.com/provider'], verifiedAt: '2026-09-10' } },
                        compatibilityFingerprint: 'compatibility:v1:current', confirmed: false,
                    },
                    endpointHealth: 'not_checked', catalog: { stale }, loadState: 'unknown', visibility: 'visible',
                }],
            }],
        });
        expect(() => DaemonProviderModelProjectionResponseV1Schema.parse(projection())).not.toThrow();
        const openRequest = {
            v: 1 as const,
            resourceId: resource.id,
            expectedResourceRevision: resource.revision,
            modelId: 'model-1',
            sourceRevision: 'source-revision-1',
            initiatorMachineId: worker.id,
            consumer: { kind: 'session' as const, sessionId: session.id },
            application: canonicalApplication,
        };
        const tryOpen = (request: ProviderBrokerOpenRequestV1, response: unknown) => openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            // Deliberately invalid: any path that reaches signing fails the test.
            signingKey: { keyId: 'must-not-sign', secretKey: new Uint8Array() },
            readProviderProjection: async () => response,
        });
        const connectedServiceSlot = {
            kind: 'connected_service_purpose' as const,
            purpose: {
                consumer: { pluginId: 'example.plugin', localId: 'consumer' },
                purpose: 'search',
            },
        };
        await db.sessionTeamCredentialBinding.deleteMany({ where: { sessionId: session.id } });
        await db.sessionTeamCredentialBinding.create({ data: {
            sessionId: session.id,
            slotKind: `${connectedServiceSlot.kind}:brokered`,
            slotKey: Buffer.from(encodeSessionTeamCredentialSlotKeyV1(connectedServiceSlot)),
            resourceId: resource.id,
            resourceRevision: resource.revision,
        } });
        let wrongSlotProjectionReads = 0;
        await expect(openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request: openRequest,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'must-not-sign', secretKey: new Uint8Array() },
            readProviderProjection: async () => {
                wrongSlotProjectionReads += 1;
                return projection();
            },
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        await expect(openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request: {
                ...openRequest,
                consumer: { kind: 'execution_run', executionRunId: 'attached-run-wrong-slot' },
            },
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'must-not-sign', secretKey: new Uint8Array() },
            resolveExecutionRunCurrentness: async () => ({
                ok: true,
                parentSessionId: session.id,
                occurrenceId: 'attached-run-wrong-slot-occurrence',
                intent: 'agent',
                runtimeState: 'idle',
            }),
            readProviderProjection: async () => {
                wrongSlotProjectionReads += 1;
                return projection();
            },
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        expect(wrongSlotProjectionReads).toBe(0);
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(0);
        await db.sessionTeamCredentialBinding.deleteMany({ where: { sessionId: session.id } });
        await db.sessionTeamCredentialBinding.create({ data: {
            sessionId: session.id,
            slotKind: 'provider_model:brokered',
            slotKey: Buffer.from(encodeSessionTeamCredentialSlotKeyV1({ kind: 'provider_model' })),
            resourceId: resource.id,
            resourceRevision: resource.revision,
        } });
        await expect(tryOpen({
            ...openRequest,
            consumer: { kind: 'execution_run', executionRunId: 'run-without-home-authority' },
        }, projection())).resolves.toEqual({ ok: false, reasonCode: 'execution_run_authority_unavailable' });
        await expect(tryOpen({ ...openRequest, expectedResourceRevision: resource.revision + 1 }, projection())).resolves.toEqual({ ok: false, reasonCode: 'resource_changed' });
        await expect(tryOpen({ ...openRequest, modelId: 'forged' }, projection())).resolves.toEqual({ ok: false, reasonCode: 'resource_unavailable' });
        await expect(tryOpen({ ...openRequest, sourceRevision: 'forged' }, projection())).resolves.toEqual({ ok: false, reasonCode: 'resource_unavailable' });
        await expect(tryOpen({ ...openRequest, application: { ...canonicalApplication, endpointTemplateId: 'forged' } }, projection())).resolves.toEqual({ ok: false, reasonCode: 'resource_unavailable' });
        await expect(tryOpen(openRequest, projection(true))).resolves.toEqual({ ok: false, reasonCode: 'resource_unavailable' });
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(0);

        const currentnessSigningKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(29));
        await db.session.update({ where: { id: session.id }, data: { active: false } });
        let inactiveProjectionReads = 0;
        await expect(openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: TEST_AUTHENTICATION,
            request: openRequest,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'currentness-home', secretKey: currentnessSigningKey.secretKey },
            readProviderProjection: async () => {
                inactiveProjectionReads += 1;
                return projection();
            },
        })).resolves.toEqual({ ok: false, reasonCode: 'session_not_active' });
        expect(inactiveProjectionReads).toBe(0);

        await db.session.update({ where: { id: session.id }, data: { active: true } });
        let brokerConnectedAtFinalObservation = true;
        await expect(openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: TEST_AUTHENTICATION,
            request: openRequest,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            readCurrentPresence: async () => ({
                initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
                brokerPresence: {
                    state: 'known',
                    machineIds: new Set(brokerConnectedAtFinalObservation ? [broker.id] : []),
                },
            }),
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'currentness-home', secretKey: currentnessSigningKey.secretKey },
            readProviderProjection: async () => {
                brokerConnectedAtFinalObservation = false;
                return projection();
            },
        })).resolves.toEqual({ ok: false, reasonCode: 'broker_unavailable' });

        const detachedSigningKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(30));
        await db.session.update({ where: { id: session.id }, data: { active: false } });
        const detachedOpen = await openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request: {
                ...openRequest,
                consumer: { kind: 'execution_run', executionRunId: 'detached-run-current' },
            },
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'detached-run-home', secretKey: detachedSigningKey.secretKey },
            resolveExecutionRunCurrentness: async () => ({
                ok: true,
                parentSessionId: null,
                occurrenceId: 'detached-occurrence-current',
                intent: 'agent',
                runtimeState: 'idle',
            }),
            readProviderProjection: async () => projection(),
        });
        if (!detachedOpen.ok) throw new Error(`expected detached Run broker open: ${detachedOpen.reasonCode}`);
        await db.session.update({ where: { id: session.id }, data: { active: true } });
        expect(detachedOpen.authority.payload).toMatchObject({
            consumer: { kind: 'execution_run', executionRunId: 'detached-run-current' },
            executionRunOccurrenceId: 'detached-occurrence-current',
        });
        const resolveDetachedRun = async () => ({
            ok: true as const,
            parentSessionId: null,
            occurrenceId: 'detached-occurrence-current',
            intent: 'agent' as const,
            runtimeState: 'idle' as const,
        });
        await expect(authorizeTeamCredentialProviderModelCatalog({
            authenticatedBrokerAccountId: custodian.id,
            authority: detachedOpen.authority,
            expectedResourceRevision: resource.revision,
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === detachedOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: resolveDetachedRun,
        })).resolves.toEqual({ ok: true });
        const authorizeDetachedCatalog = () => authorizeTeamCredentialProviderModelCatalog({
            authenticatedBrokerAccountId: custodian.id,
            authority: detachedOpen.authority,
            expectedResourceRevision: resource.revision,
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === detachedOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: resolveDetachedRun,
        });
        await db.machine.update({ where: { id: worker.id }, data: { revokedAt: new Date(1) } });
        await expect(authorizeDetachedCatalog()).resolves.toEqual({ ok: false, reasonCode: 'operation_not_current' });
        await db.machine.update({ where: { id: worker.id }, data: { revokedAt: null } });
        await db.teamMembership.update({ where: { id: requesterMembership.id }, data: { status: 'suspended' } });
        await expect(authorizeDetachedCatalog()).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        await db.teamMembership.update({ where: { id: requesterMembership.id }, data: { status: 'active' } });
        await db.teamCredentialResource.update({
            where: { id: resource.id },
            data: { sessionUsePolicy: 'team_context_required' },
        });
        await expect(authorizeDetachedCatalog()).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        await db.teamCredentialResource.update({
            where: { id: resource.id },
            data: { sessionUsePolicy: 'personal_allowed' },
        });
        const detachedRequest = (requestId: string, generation: boolean): ProviderBrokerRequestAdmissionV1 => ({
            v: 1,
            authority: detachedOpen.authority,
            expectedResourceRevision: resource.revision,
            sourceMemberKey: providerSourceMemberKey('connection-1', 'apiKey'),
            requestId,
            requestFacts: {
                generation,
                routeKind: 'openai_responses',
                modelId: 'model-1',
                reasoningEffort: null,
            },
        });
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: detachedRequest('detached-catalog-request', false),
            observedAt: new Date('2026-09-09T09:26:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === detachedOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: resolveDetachedRun,
        })).resolves.toMatchObject({
            ok: true,
            operation: { kind: 'execution_run', executionRunId: 'detached-run-current' },
            // Admitted non-generation work (token counting) is accounted on the
            // private broker exactly as it is on the external path.
            usageEventId: expect.any(String),
        });
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: detachedRequest('detached-idle-generation', true),
            observedAt: new Date('2026-09-09T09:27:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === detachedOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: resolveDetachedRun,
        })).resolves.toEqual({ ok: false, reasonCode: 'operation_not_current' });
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: detachedRequest('detached-active-generation', true),
            observedAt: new Date('2026-09-09T09:28:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === detachedOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: async () => ({
                ...await resolveDetachedRun(),
                runtimeState: 'active_turn',
            }),
        })).resolves.toMatchObject({
            ok: true,
            operation: { kind: 'execution_run', executionRunId: 'detached-run-current' },
            usageEventId: expect.any(String),
        });
        expect(await db.usageEvent.findFirst({
            where: { teamCredentialResourceId: resource.id, externalKey: 'detached-active-generation' },
            select: { accountId: true, sessionId: true },
        })).toEqual({ accountId: requester.id, sessionId: null });
        expect(await db.$queryRaw<Array<{ executionRunId: string | null }>>`
            SELECT executionRunId
            FROM UsageEvent
            WHERE teamCredentialResourceId = ${resource.id}
              AND externalKey = 'detached-active-generation'
        `).toEqual([{ executionRunId: 'detached-run-current' }]);
        await db.usageEvent.deleteMany({
            where: { teamCredentialResourceId: resource.id, externalKey: 'detached-active-generation' },
        });

        const runSigningKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(31));
        await expect(openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: TEST_AUTHENTICATION,
            request: {
                ...openRequest,
                consumer: { kind: 'execution_run', executionRunId: 'run-session-stops-during-projection' },
            },
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'run-home', secretKey: runSigningKey.secretKey },
            resolveExecutionRunCurrentness: async () => ({
                ok: true,
                parentSessionId: session.id,
                occurrenceId: 'occurrence-session-stops',
                intent: 'agent',
                runtimeState: 'active_turn',
            }),
            readProviderProjection: async () => {
                await db.session.update({ where: { id: session.id }, data: { active: false } });
                return projection();
            },
        })).resolves.toEqual({ ok: false, reasonCode: 'session_not_active' });
        await db.session.update({ where: { id: session.id }, data: { active: true } });

        const runOpen = await openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request: {
                ...openRequest,
                consumer: { kind: 'execution_run', executionRunId: 'run-current' },
            },
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'run-home', secretKey: runSigningKey.secretKey },
            resolveExecutionRunCurrentness: async () => ({
                ok: true,
                parentSessionId: session.id,
                occurrenceId: 'occurrence-current',
                intent: 'agent',
                runtimeState: 'active_turn',
            }),
            readProviderProjection: async () => projection(),
        });
        if (!runOpen.ok) throw new Error(`expected Run broker open: ${runOpen.reasonCode}`);
        expect(runOpen.authority.payload).toMatchObject({
            consumer: { kind: 'execution_run', executionRunId: 'run-current' },
            executionRunOccurrenceId: 'occurrence-current',
        });
        await expect(authorizeTeamCredentialProviderModelCatalog({
            authenticatedBrokerAccountId: custodian.id,
            authority: runOpen.authority,
            expectedResourceRevision: resource.revision,
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === runOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: async ({ expectedOccurrenceId }) => expectedOccurrenceId === 'occurrence-current'
                ? { ok: true, parentSessionId: session.id, occurrenceId: expectedOccurrenceId, intent: 'agent', runtimeState: 'idle' }
                : { ok: false, reasonCode: 'operation_not_current' },
        })).resolves.toEqual({ ok: true });
        const runRequest: ProviderBrokerRequestAdmissionV1 = {
            v: 1,
            authority: runOpen.authority,
            expectedResourceRevision: resource.revision,
            sourceMemberKey: providerSourceMemberKey('connection-1', 'apiKey'),
            requestId: 'run-request-1',
            requestFacts: {
                generation: true,
                routeKind: 'openai_responses',
                modelId: 'model-1',
                reasoningEffort: null,
            },
        };
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: runRequest,
            observedAt: new Date('2026-09-09T09:29:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === runOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: async () => ({
                ok: true,
                parentSessionId: 'wrong-parent-session',
                occurrenceId: 'occurrence-current',
                intent: 'agent',
                runtimeState: 'active_turn',
            }),
        })).resolves.toEqual({ ok: false, reasonCode: 'operation_not_current' });
        // Only the earlier admitted token-count request is accounted; the refused
        // admission above adds nothing.
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(1);
        let announceAdmissionCurrentness!: () => void;
        let releaseAdmissionCurrentness!: () => void;
        const admissionCurrentnessStarted = new Promise<void>(resolve => { announceAdmissionCurrentness = resolve; });
        const admissionCurrentnessReleased = new Promise<void>(resolve => { releaseAdmissionCurrentness = resolve; });
        const pendingRunAdmission = admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: runRequest,
            observedAt: new Date('2026-09-09T09:30:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === runOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: async ({ expectedOccurrenceId }) => {
                announceAdmissionCurrentness();
                await admissionCurrentnessReleased;
                return expectedOccurrenceId === 'occurrence-current'
                    ? {
                        ok: true,
                        parentSessionId: session.id,
                        occurrenceId: expectedOccurrenceId,
                        intent: 'agent',
                        runtimeState: 'active_turn',
                        activeTurnId: 'run-local-turn-1',
                    }
                    : { ok: false, reasonCode: 'operation_not_current' };
            },
        });
        await admissionCurrentnessStarted;
        expect(await db.usageEvent.count({
            where: { teamCredentialResourceId: resource.id, externalKey: runRequest.requestId },
        })).toBe(0);
        releaseAdmissionCurrentness();
        await expect(pendingRunAdmission).resolves.toMatchObject({
            ok: true,
            operation: { kind: 'execution_run', executionRunId: 'run-current' },
            usageEventId: expect.any(String),
        });
        expect(await db.usageEvent.findFirst({
            where: { teamCredentialResourceId: resource.id, externalKey: runRequest.requestId },
            select: {
                sessionId: true,
                turnId: true,
                brokerMachineId: true,
                teamCredentialSourceCredentialId: true,
            },
        })).toEqual({
            sessionId: session.id,
            turnId: 'run-local-turn-1',
            brokerMachineId: broker.id,
            teamCredentialSourceCredentialId: runRequest.sourceMemberKey,
        });
        expect(await db.$queryRaw<Array<{ executionRunId: string | null }>>`
            SELECT executionRunId
            FROM UsageEvent
            WHERE teamCredentialResourceId = ${resource.id}
              AND externalKey = ${runRequest.requestId}
        `).toEqual([{ executionRunId: 'run-current' }]);
        await db.usageEvent.deleteMany({ where: { teamCredentialResourceId: resource.id, externalKey: 'run-request-1' } });
        // The admitted token-count request earlier in this test is accounted too.
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(1);
        await db.usageEvent.deleteMany({ where: { teamCredentialResourceId: resource.id } });

        let announceDisconnectCurrentness!: () => void;
        let releaseDisconnectCurrentness!: () => void;
        const disconnectCurrentnessStarted = new Promise<void>(resolve => { announceDisconnectCurrentness = resolve; });
        const disconnectCurrentnessReleased = new Promise<void>(resolve => { releaseDisconnectCurrentness = resolve; });
        const disconnectedRequestId = 'run-request-broker-disconnected';
        const disconnectedAdmission = admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: { ...runRequest, requestId: disconnectedRequestId },
            observedAt: new Date('2026-09-09T09:31:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            readCurrentBrokerPresence: async () => ({ state: 'known', machineIds: new Set() }),
            verifyAuthority: candidate => candidate.payload.grantId === runOpen.authority.payload.grantId,
            resolveExecutionRunCurrentness: async ({ expectedOccurrenceId }) => {
                announceDisconnectCurrentness();
                await disconnectCurrentnessReleased;
                return expectedOccurrenceId === 'occurrence-current'
                    ? { ok: true, parentSessionId: session.id, occurrenceId: expectedOccurrenceId, intent: 'agent', runtimeState: 'active_turn' }
                    : { ok: false, reasonCode: 'operation_not_current' };
            },
        });
        await disconnectCurrentnessStarted;
        expect(await db.usageEvent.count({ where: { externalKey: disconnectedRequestId } })).toBe(0);
        releaseDisconnectCurrentness();
        await expect(disconnectedAdmission).resolves.toEqual({ ok: false, reasonCode: 'broker_unavailable' });
        expect(await db.usageEvent.count({ where: { externalKey: disconnectedRequestId } })).toBe(0);

        const authority: SignedProviderBrokerRouteGrantV1 = {
            payload: {
                v: 1,
                grantId: 'grant-1',
                aud: 'happier-provider-broker-route-v1',
                issuedAt: 1,
                expiresAt: 2,
                teamId: team.id,
                resourceId: resource.id,
                expectedResourceRevision: resource.revision,
                modelId: 'model-1',
                sourceRevision: 'source-revision-1',
                initiator: { accountId: requester.id, machineId: worker.id, endpointId: workerEndpointId },
                target: { custodianAccountId: custodian.id, machineId: broker.id, endpointId: brokerEndpointId },
                consumer: { kind: 'session', sessionId: session.id },
                application: {
                    agentTargetKey: 'codex',
                    implementationIdentity: { pluginId: 'happier.provider.cliproxyapi', localId: 'cliproxyapi' },
                    endpointTemplateId: 'openai-responses',
                    protocol: 'openai-responses',
                },
            },
            signature: { alg: 'Ed25519', keyId: 'home', valueBase64Url: 'A'.repeat(86) },
        };
        const request: ProviderBrokerRequestAdmissionV1 = {
            v: 1,
            authority,
            expectedResourceRevision: 1,
            sourceMemberKey: providerSourceMemberKey('connection-1', 'apiKey'),
            requestId: 'request-1',
            requestFacts: {
                generation: true,
                routeKind: 'openai_responses',
                modelId: 'model-1',
                reasoningEffort: null,
            },
        };
        const admit = () => admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request,
            observedAt: new Date('2026-09-09T10:00:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        });

        await expect(authorizeTeamCredentialProviderModelCatalog({
            authenticatedBrokerAccountId: custodian.id,
            authority,
            expectedResourceRevision: resource.revision,
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toEqual({ ok: true });
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(0);

        await db.sessionTeamCredentialBinding.deleteMany({ where: { sessionId: session.id } });
        await db.sessionTeamCredentialBinding.create({ data: {
            sessionId: session.id,
            slotKind: `${connectedServiceSlot.kind}:brokered`,
            slotKey: Buffer.from(encodeSessionTeamCredentialSlotKeyV1(connectedServiceSlot)),
            resourceId: resource.id,
            resourceRevision: resource.revision,
        } });
        await expect(authorizeTeamCredentialProviderModelCatalog({
            authenticatedBrokerAccountId: custodian.id,
            authority,
            expectedResourceRevision: resource.revision,
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: { ...request, requestId: 'request-connected-service-slot-substitution' },
            observedAt: new Date('2026-09-09T09:58:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(0);
        await db.sessionTeamCredentialBinding.deleteMany({ where: { sessionId: session.id } });
        await db.sessionTeamCredentialBinding.create({ data: {
            sessionId: session.id,
            slotKind: 'provider_model:brokered',
            slotKey: Buffer.from(encodeSessionTeamCredentialSlotKeyV1({ kind: 'provider_model' })),
            resourceId: resource.id,
            resourceRevision: resource.revision,
        } });

        for (const [requestId, requestFacts] of [
            ['request-model-substitution', { ...request.requestFacts, modelId: 'forged-model' }],
            ['request-protocol-substitution', { ...request.requestFacts, routeKind: 'anthropic_messages' as const }],
        ] as const) {
            await expect(admitTeamCredentialProviderBrokerRequest({
                authenticatedBrokerAccountId: custodian.id,
                request: { ...request, requestId, requestFacts },
                observedAt: new Date('2026-09-09T09:59:00.000Z'),
                brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
                verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
            })).resolves.toEqual({ ok: false, reasonCode: 'invalid_request' });
        }
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(0);

        await db.teamCredentialUsageLimit.create({ data: {
            resourceId: resource.id,
            subjectKind: 'resource',
            subjectId: '',
            period: 'day',
            metric: 'inference_requests',
            maximum: '1',
            createdAt: new Date('2026-09-09T09:00:00.000Z'),
        } });

        const firstAdmission = await admit();
        if (!firstAdmission.ok) throw new Error(`unexpected admission failure: ${firstAdmission.reasonCode}`);
        expect(firstAdmission).toMatchObject({
            ok: true,
            resourceId: resource.id,
            brokerMachineId: broker.id,
            operation: { kind: 'session', sessionId: session.id },
            usageEventId: expect.any(String),
        });
        await expect(admit()).resolves.toEqual({ ok: false, reasonCode: 'duplicate_request' });
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(1);
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: { ...request, requestId: 'request-2' },
            // A prior admission in the same millisecond is still recorded
            // usage; timestamp equality cannot create a second allowance.
            observedAt: new Date('2026-09-09T10:00:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toMatchObject({ ok: false, reasonCode: 'team_credential_usage_limit' });
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(1);

        await db.machine.update({
            where: { id: worker.id },
            data: {
                operationProtocolCapabilities: {
                    irohMachineEndpoint: { protocolVersions: [1], endpointId: 'e'.repeat(64) },
                },
                operationProtocolCapabilitiesRevision: { increment: 1 },
            },
        });
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: { ...request, requestId: 'request-worker-endpoint-rotated' },
            observedAt: new Date('2026-09-09T10:00:30.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toEqual({ ok: false, reasonCode: 'operation_not_current' });
        await db.machine.update({
            where: { id: worker.id },
            data: {
                operationProtocolCapabilities: {
                    irohMachineEndpoint: { protocolVersions: [1], endpointId: workerEndpointId },
                },
                operationProtocolCapabilitiesRevision: { increment: 1 },
            },
        });
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(1);

        await db.team.update({ where: { id: team.id }, data: { authenticationPolicy: {
            v: 1,
            mode: 'restricted',
            accepted: [{ kind: 'home_method', methodId: 'key_challenge' }],
        } } });
        const restrictedRequest = { ...request, requestId: 'request-restricted' };
        await expect(authorizeTeamCredentialProviderModelCatalog({
            authenticatedBrokerAccountId: custodian.id,
            authority,
            expectedResourceRevision: resource.revision,
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: restrictedRequest,
            observedAt: new Date('2026-09-09T10:01:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        await db.team.update({ where: { id: team.id }, data: { authenticationPolicy: null } });

        await db.sessionTeamCredentialBinding.deleteMany({ where: { sessionId: session.id } });
        await expect(admit()).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(1);
        await expect(db.sessionTurn.findUniqueOrThrow({
            where: { sessionId_turnId: { sessionId: session.id, turnId: 'turn-1' } },
            select: {
                usageActorAccountId: true,
                teamCredentialResourceId: true,
                credentialDeliveryMode: true,
            },
        })).resolves.toEqual({
            usageActorAccountId: requester.id,
            teamCredentialResourceId: resource.id,
            credentialDeliveryMode: 'brokered',
        });

        await db.sessionTeamCredentialBinding.create({ data: {
            sessionId: session.id,
            slotKind: 'provider_model:brokered',
            slotKey: Buffer.from(encodeSessionTeamCredentialSlotKeyV1({ kind: 'provider_model' })),
            resourceId: resource.id,
            resourceRevision: resource.revision,
        } });
        await db.teamCredentialResource.update({
            where: { id: resource.id },
            data: { revision: { increment: 1 } },
        });
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: {
                ...request,
                expectedResourceRevision: resource.revision + 1,
                requestId: 'request-revision-substitution',
            },
            observedAt: new Date('2026-09-09T10:02:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_changed' });
        expect(await db.usageEvent.count({ where: { teamCredentialResourceId: resource.id } })).toBe(1);
        await expect(inTx(tx => admitSessionTeamCredentialBindingInTx(tx, {
            sessionId: session.id,
            accountId: requester.id,
            slot: { kind: 'provider_model' },
            deliveryMode: 'brokered',
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
        }))).resolves.toEqual({ ok: false, reason: 'resource_changed' });
    });

    it('rechecks the exact Session-use policy on every broker request', async () => {
        const requester = await db.account.create({ data: { encryptionMode: 'plain' } });
        const custodian = await db.account.create({ data: { encryptionMode: 'plain' } });
        const team = await db.team.create({ data: { name: `Broker session policy ${crypto.randomUUID()}` } });
        const requesterMembership = await db.teamMembership.create({
            data: { teamId: team.id, accountId: requester.id, role: 'member' },
        });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: custodian.id, role: 'owner' } });
        const workerEndpointId = 'c'.repeat(64);
        const brokerEndpointId = 'd'.repeat(64);
        const worker = await db.machine.create({ data: {
            id: `worker-policy-${requester.id}`, accountId: requester.id, metadata: '{}', kind: 'persistent', active: true,
            operationProtocolCapabilities: { irohMachineEndpoint: { protocolVersions: [1], endpointId: workerEndpointId } },
            operationProtocolCapabilitiesRevision: 1,
        } });
        const broker = await db.machine.create({ data: {
            id: `broker-policy-${custodian.id}`, accountId: custodian.id, metadata: '{}', kind: 'persistent', active: true,
            operationProtocolCapabilities: {
                providerBrokerIngress: { protocolVersions: [1] },
                irohMachineEndpoint: { protocolVersions: [1], endpointId: brokerEndpointId },
            },
            operationProtocolCapabilitiesRevision: 1,
        } });
        const resource = await db.teamCredentialResource.create({ data: {
            teamId: team.id,
            custodianAccountId: custodian.id,
            displayName: 'Team-context provider',
            enabled: true,
            disclosureCeiling: 'brokered_only',
            sessionUsePolicy: 'team_context_required',
            sourceBindingJson: JSON.stringify({
                v: 1,
                kind: 'provider_connection',
                connectionId: 'connection-policy',
                connectionSecurityFingerprint: 'connection-security:v1:policy',
                credentialSlotId: 'apiKey',
            }),
            brokerMachineId: broker.id,
            memberGrants: { create: { teamMembershipId: requesterMembership.id, deliveryMode: 'brokered' } },
        } });
        const session = await db.session.create({ data: {
            id: `session-policy-${requester.id}`,
            tag: `broker-policy-${requester.id}`,
            accountId: requester.id,
            metadata: '{}',
            active: true,
            primaryTeamId: team.id,
            latestTurnId: 'turn-1',
            latestTurnStatus: 'in_progress',
        } });
        await db.accessKey.create({ data: {
            accountId: requester.id,
            machineId: worker.id,
            sessionId: session.id,
            data: '{}',
        } });
        await db.sessionTeamCredentialBinding.create({ data: {
            sessionId: session.id,
            slotKind: 'provider_model:brokered',
            slotKey: Buffer.from(encodeSessionTeamCredentialSlotKeyV1({ kind: 'provider_model' })),
            resourceId: resource.id,
            resourceRevision: resource.revision,
        } });
        await expect(applySessionTurnMutation({
            actorUserId: requester.id,
            authentication: TEST_AUTHENTICATION,
            mutation: {
                v: 1,
                sessionId: session.id,
                mutationId: 'begin-policy-turn-1',
                turnId: 'turn-1',
                action: 'begin',
                observedAt: 1,
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });
        await db.session.update({ where: { id: session.id }, data: { primaryTeamId: null } });
        const authority: SignedProviderBrokerRouteGrantV1 = {
            payload: {
                v: 1,
                grantId: `grant-policy-${requester.id}`,
                aud: 'happier-provider-broker-route-v1',
                issuedAt: 1,
                expiresAt: 2,
                teamId: team.id,
                resourceId: resource.id,
                expectedResourceRevision: resource.revision,
                modelId: 'model-1',
                sourceRevision: 'source-revision-1',
                initiator: { accountId: requester.id, machineId: worker.id, endpointId: workerEndpointId },
                target: { custodianAccountId: custodian.id, machineId: broker.id, endpointId: brokerEndpointId },
                consumer: { kind: 'session', sessionId: session.id },
                application: {
                    agentTargetKey: 'codex',
                    implementationIdentity: { pluginId: 'happier.provider.cliproxyapi', localId: 'cliproxyapi' },
                    endpointTemplateId: 'openai-responses',
                    protocol: 'openai-responses',
                },
            },
            signature: { alg: 'Ed25519', keyId: 'home', valueBase64Url: 'A'.repeat(86) },
        };
        const request: ProviderBrokerRequestAdmissionV1 = {
            v: 1,
            authority,
            expectedResourceRevision: resource.revision,
            sourceMemberKey: providerSourceMemberKey('connection-policy', 'apiKey'),
            requestId: `request-policy-${requester.id}`,
            requestFacts: { generation: false, routeKind: 'openai_responses', modelId: 'model-1', reasoningEffort: null },
        };
        // The Session binding witness exists and entitlement passes, but the
        // live Session no longer carries the required Team context.
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request,
            observedAt: new Date('2026-09-09T11:00:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        // Restoring the required Team context re-admits the same witness.
        await db.session.update({ where: { id: session.id }, data: { primaryTeamId: team.id } });
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request,
            observedAt: new Date('2026-09-09T11:00:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([broker.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === authority.payload.grantId,
        })).resolves.toMatchObject({ ok: true, resourceId: resource.id });
    });

    it('selects a source-eligible Pool member once and keeps that exact Machine authoritative after membership edits', async () => {
        const requester = await db.account.create({ data: { encryptionMode: 'plain' } });
        const custodian = await db.account.create({ data: { encryptionMode: 'plain' } });
        const team = await db.team.create({ data: { name: `Pool broker ${crypto.randomUUID()}` } });
        const requesterMembership = await db.teamMembership.create({
            data: { teamId: team.id, accountId: requester.id, role: 'member' },
        });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: custodian.id, role: 'owner' } });
        const workerEndpointId = '1'.repeat(64);
        const primaryEndpointId = '2'.repeat(64);
        const fallbackEndpointId = '3'.repeat(64);
        const worker = await db.machine.create({ data: {
            id: `pool-worker-${requester.id}`, accountId: requester.id, metadata: '{}', kind: 'persistent', active: true,
            operationProtocolCapabilities: { irohMachineEndpoint: { protocolVersions: [1], endpointId: workerEndpointId } },
            operationProtocolCapabilitiesRevision: 1,
        } });
        const brokerCapabilities = (endpointId: string) => ({
            providerBrokerIngress: { protocolVersions: [1] },
            irohMachineEndpoint: { protocolVersions: [1], endpointId },
        });
        const primary = await db.machine.create({ data: {
            id: `pool-primary-${custodian.id}`, accountId: custodian.id, metadata: '{}', kind: 'persistent', active: true,
            operationProtocolCapabilities: brokerCapabilities(primaryEndpointId),
            operationProtocolCapabilitiesRevision: 1,
        } });
        const fallback = await db.machine.create({ data: {
            id: `pool-fallback-${custodian.id}`, accountId: custodian.id, metadata: '{}', kind: 'persistent', active: true,
            operationProtocolCapabilities: brokerCapabilities(fallbackEndpointId),
            operationProtocolCapabilitiesRevision: 1,
        } });
        const pool = await db.machinePool.create({ data: {
            id: crypto.randomUUID(),
            accountId: custodian.id,
            name: 'Broker locations',
            members: { create: [
                { machineId: primary.id, priorityTier: 0, enabled: true },
                { machineId: fallback.id, priorityTier: 1, enabled: true },
            ] },
        } });
        const source = {
            v: 1 as const,
            kind: 'provider_connection' as const,
            connectionId: 'pool-connection',
            connectionSecurityFingerprint: 'connection-security:v1:pool',
            credentialSlotId: 'apiKey',
        };
        const resource = await db.teamCredentialResource.create({ data: {
            teamId: team.id,
            custodianAccountId: custodian.id,
            displayName: 'Pool provider',
            enabled: true,
            revision: 1,
            disclosureCeiling: 'brokered_only',
            sessionUsePolicy: 'personal_allowed',
            sourceBindingJson: JSON.stringify(source),
            brokerPoolId: pool.id,
            memberGrants: { create: { teamMembershipId: requesterMembership.id, deliveryMode: 'brokered' } },
        } });
        const session = await db.session.create({ data: {
            id: `pool-session-${requester.id}`,
            tag: `pool-session-${requester.id}`,
            accountId: requester.id,
            metadata: '{}',
            active: true,
        } });
        await db.accessKey.create({ data: {
            accountId: requester.id,
            machineId: worker.id,
            sessionId: session.id,
            data: '{}',
        } });
        await db.sessionTeamCredentialBinding.create({ data: {
            sessionId: session.id,
            slotKind: 'provider_model:brokered',
            slotKey: Buffer.from(encodeSessionTeamCredentialSlotKeyV1({ kind: 'provider_model' })),
            resourceId: resource.id,
            resourceRevision: resource.revision,
        } });
        const application = {
            agentTargetKey: 'agent:happier.agent.codex/codex',
            implementationIdentity: { pluginId: 'happier.provider.cliproxyapi', localId: 'cliproxyapi' },
            endpointTemplateId: 'openai-responses',
            protocol: 'openai-responses' as const,
        };
        const request: ProviderBrokerOpenRequestV1 = {
            v: 1,
            resourceId: resource.id,
            expectedResourceRevision: resource.revision,
            modelId: 'model-1',
            sourceRevision: 'source-revision-1',
            initiatorMachineId: worker.id,
            consumer: { kind: 'session', sessionId: session.id },
            application,
        };
        const projection = {
            status: 'success',
            agentTargetKey: application.agentTargetKey,
            groups: [{
                connectionId: source.connectionId,
                providerName: 'Provider', connectionName: 'Connection', connectionRole: 'default',
                connectionDisplayNameMode: 'automatic', connectionRevision: 1,
                sourceAuthority: {
                    provider: { identity: application.implementationIdentity, definitionRevision: 1 },
                    connectionSecurityFingerprint: source.connectionSecurityFingerprint,
                },
                sourceRevision: request.sourceRevision, modelLoadAction: 'available', modelLoadPreflightPolicy: null,
                authorization: { authorized: true }, manualModelPolicy: 'catalog-only',
                supportsFreeformModelIds: false, suppressedConnectedServiceIds: [],
                rows: [{
                    ref: { agentTargetKey: application.agentTargetKey, providerConnectionId: source.connectionId, modelId: request.modelId },
                    descriptor: { id: request.modelId, name: 'Model 1' }, application,
                    sources: { manual: false, static: true, probe: false }, confidence: 'verified_static',
                    compatibility: {
                        result: { status: 'verified', selectedProtocol: application.protocol, evidence: { sourceUrls: ['https://example.com/provider'], verifiedAt: '2026-09-11' } },
                        compatibilityFingerprint: 'compatibility:v1:pool', confirmed: false,
                    },
                    endpointHealth: 'not_checked', catalog: { stale: false }, loadState: 'unknown', visibility: 'visible',
                }],
            }],
        };
        const signingKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(41));
        expect(() => DaemonProviderModelProjectionResponseV1Schema.parse(projection)).not.toThrow();

        await db.machinePoolMember.update({
            where: { poolId_machineId: { poolId: pool.id, machineId: fallback.id } },
            data: { priorityTier: 0 },
        });
        const ordinarySessionSelection = selectMachinePoolCandidate({
            members: [primary.id, fallback.id].map(machineId => ({ machineId, priorityTier: 0, enabled: true })),
            availableMachineIds: new Set([primary.id, fallback.id]),
            requestKey: [resource.id, 'session', session.id].join('\u0000'),
        });
        if (!ordinarySessionSelection) throw new Error('Expected ordinary Session Pool placement');
        const reviewedRunnerMachineId = ordinarySessionSelection.machineId === primary.id ? fallback.id : primary.id;
        const activationId = crypto.randomUUID();
        const homeServerIdentityId = crypto.randomUUID();
        const installationId = crypto.randomUUID();
        const installationPublicKeyBytes = new Uint8Array(32).fill(37);
        const installationPublicKey = Buffer.from(installationPublicKeyBytes).toString('base64url');
        await db.machine.update({
            where: { id: worker.id },
            data: {
                kind: 'ephemeral_session_runner',
                installationId,
                installationPublicKey: installationPublicKeyBytes,
            },
        });
        const runnerSelection = {
            v: 1 as const,
            request: {
                v: 1 as const,
                selection: {
                    kind: 'team_credential_provider_model' as const,
                    resourceId: resource.id,
                    teamId: team.id,
                    expectedResourceRevision: resource.revision,
                    deliveryMode: 'brokered' as const,
                    agentTargetKey: application.agentTargetKey,
                    modelId: request.modelId,
                },
                application,
                sourceRevision: request.sourceRevision,
                plannedSession: { primaryTeamId: null, teamVisibilityTeamIds: [] },
            },
            binding: {
                v: 1 as const,
                resourceId: resource.id,
                brokerMachineId: reviewedRunnerMachineId,
                revision: resource.revision,
                application,
                sourceRevision: request.sourceRevision,
            },
        };
        await db.ephemeralRunnerActivation.create({ data: {
            id: activationId,
            creatorAccountId: requester.id,
            creatorTokenEpoch: requester.tokenEpoch,
            draftId: crypto.randomUUID(),
            sessionId: session.id,
            machineId: worker.id,
            state: 'materialized',
            workspacePolicy: 'choose_on_endpoint',
            homeServerIdentityId,
            activationSigningPublicKey: Buffer.alloc(32, 11).toString('base64url'),
            authoringCommitment: Buffer.alloc(32, 12).toString('base64url'),
            artifact: {},
            endpointFactsRecipient: {},
            authenticationEvidence: {
                v: 1,
                evidence: [{ kind: 'home_method', methodId: 'key_challenge' }],
            },
            credentialSelection: runnerSelection,
            review: {
                sealedLaunchManifest: 'sealed-runner-manifest',
                authoringCommitment: Buffer.alloc(32, 12).toString('base64url'),
                launchManifestCommitment: Buffer.alloc(32, 13).toString('base64url'),
                endpointFactsProof: {
                    activationSignature: Buffer.alloc(64, 14).toString('base64url'),
                    installationSignature: Buffer.alloc(64, 15).toString('base64url'),
                },
                agentTargetKey: application.agentTargetKey,
                machineContentKeyBinding: null,
                credentialSelectionBinding: runnerSelection.binding,
                displayFacts: {
                    v: 1,
                    homeId: homeServerIdentityId,
                    homeName: 'Runner Home',
                    requesterId: requester.id,
                    requesterName: 'Runner Creator',
                    teamId: team.id,
                    teamName: 'Runner Team',
                },
            },
        } });
        const runnerPrincipal = {
            kind: 'ephemeral_session_runner' as const,
            authority: 'session_runtime' as const,
            accountId: requester.id,
            activationId,
            sessionId: session.id,
            machineId: worker.id,
            installationId,
            installationPublicKey,
            creatorTokenEpoch: requester.tokenEpoch,
        };
        await db.machinePoolMember.delete({
            where: { poolId_machineId: { poolId: pool.id, machineId: reviewedRunnerMachineId } },
        });
        await expect(openRunnerTeamCredentialProviderBroker({
            principal: runnerPrincipal,
            actorAccountId: requester.id,
            authentication: {
                env: process.env,
                authority: 'account_automation',
                authenticationEvidence: [],
                sessionRuntimePrincipal: runnerPrincipal,
            },
            request: { ...request, modelId: 'forged-model' },
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([primary.id, fallback.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'runner-home', secretKey: signingKey.secretKey },
            readPoolSourceEligibility: async () => {
                throw new Error('forged Runner open must fail before Pool selection');
            },
            readProviderProjection: async () => {
                throw new Error('forged Runner open must fail before provider projection');
            },
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_forbidden' });
        const runnerOpen = await openRunnerTeamCredentialProviderBroker({
            principal: runnerPrincipal,
            actorAccountId: requester.id,
            authentication: {
                env: process.env,
                authority: 'account_automation',
                authenticationEvidence: [{ kind: 'home_method', methodId: 'key_challenge' }],
                sessionRuntimePrincipal: runnerPrincipal,
            },
            request,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([primary.id, fallback.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'runner-home', secretKey: signingKey.secretKey },
            readPoolSourceEligibility: async () => {
                throw new Error('reviewed Runner selection must not enumerate or rerank its Pool');
            },
            readProviderProjection: async input => {
                expect(input.brokerMachineId).toBe(reviewedRunnerMachineId);
                return projection;
            },
        });
        if (!runnerOpen.ok) throw new Error(`expected reviewed Runner broker open: ${runnerOpen.reasonCode}`);
        expect(runnerOpen.target.brokerMachineId).toBe(reviewedRunnerMachineId);
        expect(runnerOpen.target.brokerMachineId).not.toBe(ordinarySessionSelection.machineId);
        const admitRunner = (requestId: string) => admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: {
                v: 1,
                authority: runnerOpen.authority,
                expectedResourceRevision: resource.revision,
                sourceMemberKey: providerSourceMemberKey(source.connectionId, source.credentialSlotId),
                requestId,
                requestFacts: {
                    generation: false,
                    routeKind: 'openai_responses',
                    modelId: request.modelId,
                    reasoningEffort: null,
                },
            },
            observedAt: new Date(1),
            brokerPresence: { state: 'known', machineIds: new Set([reviewedRunnerMachineId]) },
            verifyAuthority: candidate => candidate.payload.grantId === runnerOpen.authority.payload.grantId,
        });
        await expect(admitRunner('runner-current')).resolves.toMatchObject({ ok: true });
        await db.account.update({ where: { id: requester.id }, data: { tokenEpoch: { increment: 1 } } });
        await expect(admitRunner('runner-creator-epoch-revoked')).resolves.toEqual({
            ok: false,
            reasonCode: 'operation_not_current',
        });
        await db.account.update({ where: { id: requester.id }, data: { tokenEpoch: requester.tokenEpoch } });
        await db.machinePoolMember.create({ data: {
            poolId: pool.id,
            machineId: reviewedRunnerMachineId,
            priorityTier: 0,
            enabled: true,
        } });

        const members = [primary.id, fallback.id].map(machineId => ({ machineId, priorityTier: 0, enabled: true }));
        const availableMachineIds = new Set([primary.id, fallback.id]);
        const runByMachineId = new Map<string, string>();
        for (let index = 0; runByMachineId.size < 2 && index < 1_000; index += 1) {
            const executionRunId = `pool-run-${index}`;
            const selected = selectMachinePoolCandidate({
                members,
                availableMachineIds,
                requestKey: [resource.id, 'execution_run', executionRunId].join('\u0000'),
            });
            if (selected) runByMachineId.set(selected.machineId, executionRunId);
        }
        expect(runByMachineId.size).toBe(2);
        for (const [expectedMachineId, executionRunId] of runByMachineId) {
            const runOpen = await openTeamCredentialProviderBroker({
                actorAccountId: requester.id,
                authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
                request: { ...request, consumer: { kind: 'execution_run', executionRunId } },
                initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
                brokerPresence: { state: 'known', machineIds: availableMachineIds },
                nowMs: 1,
                grantId: crypto.randomUUID(),
                signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
                resolveExecutionRunCurrentness: async () => ({
                    ok: true,
                    parentSessionId: session.id,
                    occurrenceId: `occurrence-${executionRunId}`,
                    intent: 'agent',
                    runtimeState: 'active_turn',
                }),
                readPoolSourceEligibility: async () => ({ eligibleMachineIds: availableMachineIds, reasons: new Map() }),
                readProviderProjection: async () => projection,
            });
            if (!runOpen.ok) throw new Error(`expected Execution Run Pool broker open: ${runOpen.reasonCode}`);
            expect(runOpen.target.brokerMachineId).toBe(expectedMachineId);
            expect(runOpen.authority.payload).toMatchObject({
                consumer: { kind: 'execution_run', executionRunId },
                executionRunOccurrenceId: `occurrence-${executionRunId}`,
            });
        }

        const slowTarget = [...runByMachineId.entries()][0];
        if (!slowTarget) throw new Error('expected a Pool target for the slow RPC topology test');
        const [slowExpectedMachineId, slowExecutionRunId] = slowTarget;
        const previousTransactionTimeout = process.env.HAPPIER_DB_TX_TIMEOUT_MS;
        const previousTransactionRetries = process.env.HAPPIER_DB_TX_MAX_RETRIES;
        process.env.HAPPIER_DB_TX_TIMEOUT_MS = '1000';
        process.env.HAPPIER_DB_TX_MAX_RETRIES = '0';
        let slowCurrentnessCalls = 0;
        let slowEligibilityCalls = 0;
        let slowProjectionCalls = 0;
        const delayBeyondTransactionTimeout = () => new Promise<void>(resolve => setTimeout(resolve, 1_250));
        try {
            const slowOpen = await openTeamCredentialProviderBroker({
                actorAccountId: requester.id,
                authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
                request: { ...request, consumer: { kind: 'execution_run', executionRunId: slowExecutionRunId } },
                initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
                brokerPresence: { state: 'known', machineIds: availableMachineIds },
                nowMs: 1,
                grantId: crypto.randomUUID(),
                signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
                resolveExecutionRunCurrentness: async () => {
                    slowCurrentnessCalls += 1;
                    await delayBeyondTransactionTimeout();
                    return {
                        ok: true,
                        parentSessionId: session.id,
                        occurrenceId: `slow-occurrence-${slowExecutionRunId}`,
                        intent: 'agent',
                        runtimeState: 'active_turn',
                    };
                },
                readPoolSourceEligibility: async () => {
                    slowEligibilityCalls += 1;
                    await delayBeyondTransactionTimeout();
                    return { eligibleMachineIds: new Set([slowExpectedMachineId]), reasons: new Map() };
                },
                readProviderProjection: async () => {
                    slowProjectionCalls += 1;
                    await delayBeyondTransactionTimeout();
                    return projection;
                },
            });
            if (!slowOpen.ok) throw new Error(`expected slow RPC broker open: ${slowOpen.reasonCode}`);
            expect(slowOpen.target.brokerMachineId).toBe(slowExpectedMachineId);
            expect(slowOpen.authority.payload.executionRunOccurrenceId).toBe(`slow-occurrence-${slowExecutionRunId}`);
            expect({ slowCurrentnessCalls, slowEligibilityCalls, slowProjectionCalls }).toEqual({
                slowCurrentnessCalls: 2,
                slowEligibilityCalls: 1,
                slowProjectionCalls: 1,
            });
        } finally {
            if (previousTransactionTimeout === undefined) delete process.env.HAPPIER_DB_TX_TIMEOUT_MS;
            else process.env.HAPPIER_DB_TX_TIMEOUT_MS = previousTransactionTimeout;
            if (previousTransactionRetries === undefined) delete process.env.HAPPIER_DB_TX_MAX_RETRIES;
            else process.env.HAPPIER_DB_TX_MAX_RETRIES = previousTransactionRetries;
        }

        const eligibilityCalls: unknown[] = [];
        let announceEligibility!: () => void;
        let releaseEligibility!: () => void;
        const eligibilityStarted = new Promise<void>((resolve) => { announceEligibility = resolve; });
        const eligibilityReleased = new Promise<void>((resolve) => { releaseEligibility = resolve; });
        const racingOpen = openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([primary.id, fallback.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
            readPoolSourceEligibility: async () => {
                announceEligibility();
                await eligibilityReleased;
                return { eligibleMachineIds: new Set([fallback.id]), reasons: new Map() };
            },
            readProviderProjection: async () => projection,
        });
        await eligibilityStarted;
        await db.machinePoolMember.update({
            where: { poolId_machineId: { poolId: pool.id, machineId: fallback.id } },
            data: { enabled: false },
        });
        releaseEligibility();
        await expect(racingOpen).resolves.toEqual({ ok: false, reasonCode: 'broker_unavailable' });
        await db.machinePoolMember.update({
            where: { poolId_machineId: { poolId: pool.id, machineId: fallback.id } },
            data: { enabled: true },
        });

        const projectionRacePresence = new Set([primary.id, fallback.id]);
        await expect(openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: projectionRacePresence },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
            readPoolSourceEligibility: async () => ({
                eligibleMachineIds: new Set([fallback.id]),
                reasons: new Map(),
            }),
            readProviderProjection: async () => {
                projectionRacePresence.delete(fallback.id);
                return projection;
            },
        })).resolves.toEqual({ ok: false, reasonCode: 'broker_unavailable' });

        let announceEndpointProjection!: () => void;
        let releaseEndpointProjection!: () => void;
        const endpointProjectionStarted = new Promise<void>(resolve => { announceEndpointProjection = resolve; });
        const endpointProjectionReleased = new Promise<void>(resolve => { releaseEndpointProjection = resolve; });
        const endpointRotationRace = openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: TEST_AUTHENTICATION,
            request,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([primary.id, fallback.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
            readPoolSourceEligibility: async () => ({
                eligibleMachineIds: new Set([fallback.id]),
                reasons: new Map(),
            }),
            readProviderProjection: async () => {
                announceEndpointProjection();
                await endpointProjectionReleased;
                return projection;
            },
        });
        await endpointProjectionStarted;
        await db.machine.update({
            where: { id: fallback.id },
            data: {
                operationProtocolCapabilities: brokerCapabilities('6'.repeat(64)),
                operationProtocolCapabilitiesRevision: { increment: 1 },
            },
        });
        releaseEndpointProjection();
        await expect(endpointRotationRace).resolves.toEqual({ ok: false, reasonCode: 'broker_unavailable' });
        await db.machine.update({
            where: { id: fallback.id },
            data: {
                operationProtocolCapabilities: brokerCapabilities(fallbackEndpointId),
                operationProtocolCapabilitiesRevision: { increment: 1 },
            },
        });

        let announcePersistedProjection!: () => void;
        let releasePersistedProjection!: () => void;
        const persistedProjectionStarted = new Promise<void>((resolve) => { announcePersistedProjection = resolve; });
        const persistedProjectionReleased = new Promise<void>((resolve) => { releasePersistedProjection = resolve; });
        const persistedProjectionRace = openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([primary.id, fallback.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
            readPoolSourceEligibility: async () => ({
                eligibleMachineIds: new Set([fallback.id]),
                reasons: new Map(),
            }),
            readProviderProjection: async () => {
                announcePersistedProjection();
                await persistedProjectionReleased;
                return projection;
            },
        });
        await persistedProjectionStarted;
        await db.teamCredentialResource.update({
            where: { id: resource.id },
            data: { revision: { increment: 1 } },
        });
        releasePersistedProjection();
        await expect(persistedProjectionRace).resolves.toEqual({ ok: false, reasonCode: 'resource_changed' });
        await db.teamCredentialResource.update({
            where: { id: resource.id },
            data: { revision: resource.revision },
        });

        const opened = await openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request,
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([primary.id, fallback.id]) },
            nowMs: 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
            readPoolSourceEligibility: async input => {
                eligibilityCalls.push(input);
                return {
                    eligibleMachineIds: new Set([fallback.id]),
                    reasons: new Map([[primary.id, 'model_unavailable']]),
                };
            },
            readProviderProjection: async input => {
                expect(input.brokerMachineId).toBe(fallback.id);
                return projection;
            },
        });
        if (!opened.ok) throw new Error(`expected Pool broker open: ${opened.reasonCode}`);
        expect(opened).toMatchObject({
            ok: true,
            target: { custodianAccountId: custodian.id, brokerMachineId: fallback.id, endpointId: fallbackEndpointId },
        });
        expect(eligibilityCalls).toEqual([expect.objectContaining({
            custodianAccountId: custodian.id,
            machineIds: expect.arrayContaining([primary.id, fallback.id]),
            teamId: team.id,
            resourceId: resource.id,
            resourceRevision: resource.revision,
            source,
            application,
            modelId: request.modelId,
            sourceRevision: request.sourceRevision,
            signal: expect.any(AbortSignal),
        })]);

        // Pool membership is selection input for a new open, not an ongoing ACL.
        await db.machinePoolMember.delete({ where: { poolId_machineId: { poolId: pool.id, machineId: fallback.id } } });
        const admissionRequest: ProviderBrokerRequestAdmissionV1 = {
            v: 1,
            authority: opened.authority,
            expectedResourceRevision: resource.revision,
            sourceMemberKey: providerSourceMemberKey(source.connectionId, source.credentialSlotId),
            requestId: crypto.randomUUID(),
            requestFacts: { generation: false, routeKind: 'openai_responses', modelId: request.modelId, reasoningEffort: null },
        };
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: admissionRequest,
            observedAt: new Date('2026-09-11T10:00:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([fallback.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === opened.authority.payload.grantId,
        })).resolves.toMatchObject({ ok: true, brokerMachineId: fallback.id });

        const refreshed = await openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request: { ...request, refreshAuthority: opened.authority },
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([fallback.id]) },
            nowMs: opened.authority.payload.expiresAt + 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
            verifyRefreshAuthority: candidate => candidate.payload.grantId === opened.authority.payload.grantId,
            readPoolSourceEligibility: async () => {
                throw new Error('refresh_must_not_rerank_pool');
            },
            readProviderProjection: async input => {
                expect(input.brokerMachineId).toBe(fallback.id);
                return projection;
            },
        });
        if (!refreshed.ok) throw new Error(`expected pinned Pool broker refresh: ${refreshed.reasonCode}`);
        expect(refreshed.authority.payload.grantId).not.toBe(opened.authority.payload.grantId);
        expect(refreshed.authority.payload.expiresAt).toBeGreaterThan(opened.authority.payload.expiresAt);
        expect(refreshed.target.brokerMachineId).toBe(fallback.id);

        await db.machine.update({ where: { id: fallback.id }, data: { revokedAt: new Date() } });
        await expect(openTeamCredentialProviderBroker({
            actorAccountId: requester.id,
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: [] },
            request: { ...request, refreshAuthority: refreshed.authority },
            initiatorPresence: { state: 'known', machineIds: new Set([worker.id]) },
            brokerPresence: { state: 'known', machineIds: new Set([fallback.id]) },
            nowMs: refreshed.authority.payload.expiresAt + 1,
            grantId: crypto.randomUUID(),
            signingKey: { keyId: 'test-home', secretKey: signingKey.secretKey },
            verifyRefreshAuthority: () => true,
            readPoolSourceEligibility: async () => {
                throw new Error('revoked refresh must not rerank pool');
            },
            readProviderProjection: async () => projection,
        })).resolves.toEqual({ ok: false, reasonCode: 'broker_unavailable' });
        await db.machine.update({ where: { id: fallback.id }, data: { revokedAt: null } });

        const beforeDeleteChanges = await db.accountChange.count({
            where: { accountId: requester.id, entityId: 'teams' },
        });
        const poolIo: MachineDaemonPresenceSocketServer = { in: () => ({ fetchSockets: async () => [] }) };
        await expect(deleteMachinePool({
            accountId: custodian.id,
            input: { poolId: pool.id, expectedRevision: pool.revision },
            io: poolIo,
        })).resolves.toEqual({ ok: true, value: { poolId: pool.id, deleted: true } });
        await expect(db.teamCredentialResource.findUniqueOrThrow({
            where: { id: resource.id },
            select: { brokerMachineId: true, brokerPoolId: true, revision: true },
        })).resolves.toEqual({ brokerMachineId: null, brokerPoolId: null, revision: resource.revision + 1 });
        expect(await db.accountChange.count({
            where: { accountId: requester.id, entityId: 'teams' },
        })).toBeGreaterThan(beforeDeleteChanges);
        await expect(admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: custodian.id,
            request: admissionRequest,
            observedAt: new Date('2026-09-11T10:01:00.000Z'),
            brokerPresence: { state: 'known', machineIds: new Set([fallback.id]) },
            verifyAuthority: candidate => candidate.payload.grantId === opened.authority.payload.grantId,
        })).resolves.toEqual({ ok: false, reasonCode: 'resource_changed' });
    });
});
