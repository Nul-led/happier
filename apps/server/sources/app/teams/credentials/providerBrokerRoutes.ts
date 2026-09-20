import {
    PROVIDER_BROKER_OPEN_HTTP_PATH_V1,
    PROVIDER_BROKER_MODEL_CATALOG_AUTHORIZE_HTTP_PATH_V1,
    PROVIDER_BROKER_REQUEST_ADMISSION_HTTP_PATH_V1,
    RPC_METHODS,
    ProviderBrokerOpenRequestV1Schema,
    ProviderBrokerModelCatalogAuthorizationV1Schema,
    ProviderBrokerModelCatalogAuthorizationResponseV1Schema,
    ProviderBrokerOpenResponseV1Schema,
    ProviderBrokerRequestAdmissionV1Schema,
    ProviderBrokerRequestAdmissionResponseV1Schema,
} from '@happier-dev/protocol';
import {
    TEAM_CREDENTIAL_EXTERNAL_PROVIDER_ADMISSION_HTTP_PATH_V1,
    TEAM_CREDENTIAL_EXTERNAL_PROVIDER_TERMINAL_USAGE_HTTP_PATH_V1,
    TEAM_CREDENTIAL_RESOURCE_TEST_ADMISSION_HTTP_PATH_V1,
    TeamCredentialExternalProviderAdmissionResponseV1Schema,
    TeamCredentialExternalProviderAdmissionV1Schema,
    TeamCredentialExternalProviderTerminalUsageResponseV1Schema,
    TeamCredentialExternalProviderTerminalUsageV1Schema,
    TeamCredentialExternalProviderModelCatalogAuthorizationV1Schema,
    TeamCredentialResourceTestAdmissionResponseV1Schema,
    TeamCredentialResourceTestAdmissionV1Schema,
} from '@happier-dev/protocol/teams';

import type { Fastify } from '@/app/api/types';
import { getMachineDaemonPresenceInventory } from '@/app/machines/machineDaemonPresence';
import { resolvePeerMediationGrantSigningConfig } from '@/app/machines/peer/mediation/mintDirectRouteGrantV1';
import { verifyProviderBrokerRouteGrantSignatureV1 } from '@/app/machines/peer/mediation/signProviderBrokerRouteGrantV1';
import { verifyRunnerBrokerOpenSelectionInTx } from '@/app/ephemeralRunner/runnerBrokerOpenSelection';
import { readSessionAccessAuthenticationFromRequest } from '@/app/session/access/sessionAccessAuthentication';
import { inTx } from '@/storage/inTx';
import { getOrCreateServerIdentityId } from '@/app/serverIdentity/serverIdentity';
import { createExecutionRunBrokerCurrentnessResolver } from './executionRunBrokerAuthorityResolver';
import { createTeamCredentialPoolSourceEligibilityReader } from './poolSourceEligibility';
import {
    admitTeamCredentialProviderBrokerRequest,
    authorizeTeamCredentialProviderModelCatalog,
    openRunnerTeamCredentialProviderBroker,
    openTeamCredentialProviderBroker,
    type TeamCredentialProviderBrokerOpenInput,
} from './providerBrokerAdmission';
import {
    admitTeamCredentialExternalProviderRequestInTx,
    authorizeTeamCredentialExternalProviderModelCatalogInTx,
    recordTeamCredentialExternalProviderTerminalUsageInTx,
} from './externalProviderBrokerAdmission';
import { admitTeamCredentialResourceTestRequestInTx } from './resourceTestBrokerAdmission';

export function registerTeamCredentialProviderBrokerRoutes(app: Fastify): void {
    const resolveExecutionRunCurrentness = createExecutionRunBrokerCurrentnessResolver({
        app,
        resolveServerIdentityId: () => getOrCreateServerIdentityId(process.env),
        createNonce: () => crypto.randomUUID(),
    });
    const modelCatalogAuthorizationSchema = ProviderBrokerModelCatalogAuthorizationV1Schema
        .or(TeamCredentialExternalProviderModelCatalogAuthorizationV1Schema);
    app.post(PROVIDER_BROKER_MODEL_CATALOG_AUTHORIZE_HTTP_PATH_V1, {
        preHandler: app.authenticate,
        attachValidation: true,
        schema: {
            body: modelCatalogAuthorizationSchema,
            response: {
                200: ProviderBrokerModelCatalogAuthorizationResponseV1Schema,
                400: ProviderBrokerModelCatalogAuthorizationResponseV1Schema,
            },
        },
    }, async (request, reply) => {
        const parsed = modelCatalogAuthorizationSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ ok: false, reasonCode: 'invalid_request' });
        const external = TeamCredentialExternalProviderModelCatalogAuthorizationV1Schema.safeParse(parsed.data);
        if (external.success) {
            const result = await inTx(tx => authorizeTeamCredentialExternalProviderModelCatalogInTx(tx, {
                authenticatedBrokerAccountId: request.userId,
                request: external.data,
                observedAt: new Date(),
            }));
            return reply.send(ProviderBrokerModelCatalogAuthorizationResponseV1Schema.parse(result));
        }
        const broker = ProviderBrokerModelCatalogAuthorizationV1Schema.parse(parsed.data);
        const signing = resolvePeerMediationGrantSigningConfig(process.env);
        if (!signing.ok) return reply.send({ ok: false, reasonCode: 'update_required' });
        const result = await authorizeTeamCredentialProviderModelCatalog({
            authenticatedBrokerAccountId: request.userId,
            authority: broker.authority,
            expectedResourceRevision: broker.expectedResourceRevision,
            readCurrentBrokerPresence: () => getMachineDaemonPresenceInventory({
                accountId: request.userId,
                io: app.machineDaemonPresence,
            }),
            verifyAuthority: authority => verifyProviderBrokerRouteGrantSignatureV1({
                authority,
                signingCapability: signing.capability,
                nowMs: Date.now(),
            }),
            resolveExecutionRunCurrentness,
        });
        return reply.send(ProviderBrokerModelCatalogAuthorizationResponseV1Schema.parse(result));
    });
    app.post(TEAM_CREDENTIAL_RESOURCE_TEST_ADMISSION_HTTP_PATH_V1, {
        preHandler: app.authenticate,
        attachValidation: true,
        schema: {
            body: TeamCredentialResourceTestAdmissionV1Schema,
            response: { 200: TeamCredentialResourceTestAdmissionResponseV1Schema, 400: TeamCredentialResourceTestAdmissionResponseV1Schema },
        },
    }, async (request, reply) => {
        const parsed = TeamCredentialResourceTestAdmissionV1Schema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ ok: false, reasonCode: 'invalid_request' });
        const relaySigning = resolvePeerMediationGrantSigningConfig(process.env);
        if (!relaySigning.ok) return reply.send({ ok: false, reasonCode: 'invalid_request' });
        const result = await inTx(tx => admitTeamCredentialResourceTestRequestInTx(tx, {
            authenticatedBrokerAccountId: request.userId,
            request: parsed.data,
            observedAt: new Date(),
            relayAuthorizationTrustRoots: [{
                keyId: relaySigning.capability.keyId,
                publicKeyBase64Url: relaySigning.capability.publicKey,
                expiresAt: relaySigning.capability.expiresAt,
            }],
        }));
        return reply.send(TeamCredentialResourceTestAdmissionResponseV1Schema.parse(result));
    });
    app.post(TEAM_CREDENTIAL_EXTERNAL_PROVIDER_ADMISSION_HTTP_PATH_V1, {
        preHandler: app.authenticate,
        attachValidation: true,
        schema: {
            body: TeamCredentialExternalProviderAdmissionV1Schema,
            response: { 200: TeamCredentialExternalProviderAdmissionResponseV1Schema, 400: TeamCredentialExternalProviderAdmissionResponseV1Schema },
        },
    }, async (request, reply) => {
        const parsed = TeamCredentialExternalProviderAdmissionV1Schema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ ok: false, reasonCode: 'invalid_request' });
        const result = await inTx(tx => admitTeamCredentialExternalProviderRequestInTx(tx, {
            authenticatedBrokerAccountId: request.userId,
            request: parsed.data,
            observedAt: new Date(),
        }));
        return reply.send(TeamCredentialExternalProviderAdmissionResponseV1Schema.parse(result));
    });
    app.post(TEAM_CREDENTIAL_EXTERNAL_PROVIDER_TERMINAL_USAGE_HTTP_PATH_V1, {
        preHandler: app.authenticate,
        attachValidation: true,
        schema: {
            body: TeamCredentialExternalProviderTerminalUsageV1Schema,
            response: {
                200: TeamCredentialExternalProviderTerminalUsageResponseV1Schema,
                400: TeamCredentialExternalProviderTerminalUsageResponseV1Schema,
            },
        },
    }, async (request, reply) => {
        const parsed = TeamCredentialExternalProviderTerminalUsageV1Schema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ ok: false, reasonCode: 'invalid_request' });
        const result = await inTx(tx => recordTeamCredentialExternalProviderTerminalUsageInTx(tx, {
            authenticatedBrokerAccountId: request.userId,
            request: parsed.data,
        }));
        return reply.send(TeamCredentialExternalProviderTerminalUsageResponseV1Schema.parse(result));
    });
    app.post(PROVIDER_BROKER_OPEN_HTTP_PATH_V1, {
        preHandler: app.authenticate,
        config: {
            ephemeralSessionRunnerBinding: {
                scope: 'session',
                session: 'body.consumer.sessionId',
                machine: 'body.initiatorMachineId',
            },
        },
        attachValidation: true,
        schema: {
            body: ProviderBrokerOpenRequestV1Schema,
            response: { 200: ProviderBrokerOpenResponseV1Schema, 400: ProviderBrokerOpenResponseV1Schema },
        },
    }, async (request, reply) => {
        const parsed = ProviderBrokerOpenRequestV1Schema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ ok: false, reasonCode: 'invalid_request' });
        }
        const signing = resolvePeerMediationGrantSigningConfig(process.env);
        if (!signing.ok) {
            return reply.send({ ok: false, reasonCode: 'update_required' });
        }
        if (request.sessionRuntimePrincipal) {
            const runnerSelection = await inTx(tx => verifyRunnerBrokerOpenSelectionInTx(tx, {
                principal: request.sessionRuntimePrincipal!,
                request: parsed.data,
            }));
            if (!runnerSelection) {
                return reply.send({ ok: false, reasonCode: 'resource_forbidden' });
            }
        }
        const readCurrentPresence: TeamCredentialProviderBrokerOpenInput['readCurrentPresence'] = async presence => {
            const [currentInitiatorPresence, currentBrokerPresence] = await Promise.all([
                getMachineDaemonPresenceInventory({
                    accountId: presence.initiatorAccountId,
                    io: app.machineDaemonPresence,
                }),
                getMachineDaemonPresenceInventory({
                    accountId: presence.brokerAccountId,
                    io: app.machineDaemonPresence,
                }),
            ]);
            return {
                initiatorPresence: currentInitiatorPresence,
                brokerPresence: currentBrokerPresence,
            };
        };
        const eligibilityAbort = new AbortController();
        const abortEligibility = () => eligibilityAbort.abort(new Error('broker_open_client_closed'));
        request.raw.once('aborted', abortEligibility);
        reply.raw.once('close', abortEligibility);
        try {
        const openInput: TeamCredentialProviderBrokerOpenInput = {
            actorAccountId: request.userId,
            authentication: readSessionAccessAuthenticationFromRequest(request),
            request: parsed.data,
            readCurrentPresence,
            nowMs: Date.now(),
            grantId: crypto.randomUUID(),
            signingKey: { keyId: signing.keyId, secretKey: signing.secretKey },
            verifyRefreshAuthority: authority => verifyProviderBrokerRouteGrantSignatureV1({
                authority,
                signingCapability: signing.capability,
                nowMs: Date.now(),
            }),
            signal: eligibilityAbort.signal,
            readPoolSourceEligibility: createTeamCredentialPoolSourceEligibilityReader(app.forwardRpcForUser),
            resolveExecutionRunCurrentness,
            readProviderProjection: async projection => {
                const rpcResult = await app.forwardRpcForUser({
                    userId: projection.custodianAccountId,
                    method: `${projection.brokerMachineId}:${RPC_METHODS.DAEMON_PROVIDERS_MODEL_PROJECTION}`,
                    params: {
                        machineId: projection.brokerMachineId,
                        agentTargetKey: projection.agentTargetKey,
                        application: projection.application,
                        ...(projection.source.kind === 'provider_connection'
                            ? { providerConnection: {
                                connectionId: projection.source.connectionId,
                                expectedConnectionSecurityFingerprint: projection.source.connectionSecurityFingerprint,
                            } }
                            : { connectedAccountTarget: projection.source.target }),
                    },
                });
                if (!rpcResult.ok) throw new Error('Provider projection unavailable');
                return rpcResult.result;
            },
        };
        const result = await (request.sessionRuntimePrincipal
            ? openRunnerTeamCredentialProviderBroker({
                ...openInput,
                principal: request.sessionRuntimePrincipal!,
            })
            : openTeamCredentialProviderBroker(openInput));
        return reply.send(ProviderBrokerOpenResponseV1Schema.parse(result));
        } finally {
            request.raw.off('aborted', abortEligibility);
            reply.raw.off('close', abortEligibility);
        }
    });

    app.post(PROVIDER_BROKER_REQUEST_ADMISSION_HTTP_PATH_V1, {
        preHandler: app.authenticate,
        attachValidation: true,
        schema: {
            body: ProviderBrokerRequestAdmissionV1Schema,
            response: { 200: ProviderBrokerRequestAdmissionResponseV1Schema, 400: ProviderBrokerRequestAdmissionResponseV1Schema },
        },
    }, async (request, reply) => {
        const parsed = ProviderBrokerRequestAdmissionV1Schema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ ok: false, reasonCode: 'invalid_request' });
        }
        const signing = resolvePeerMediationGrantSigningConfig(process.env);
        if (!signing.ok) {
            return reply.send({ ok: false, reasonCode: 'update_required' });
        }
        const observedAt = new Date();
        const result = await admitTeamCredentialProviderBrokerRequest({
            authenticatedBrokerAccountId: request.userId,
            request: parsed.data,
            observedAt,
            readCurrentBrokerPresence: () => getMachineDaemonPresenceInventory({
                accountId: request.userId,
                io: app.machineDaemonPresence,
            }),
            verifyAuthority: authority => verifyProviderBrokerRouteGrantSignatureV1({
                authority,
                signingCapability: signing.capability,
                nowMs: observedAt.getTime(),
            }),
            resolveExecutionRunCurrentness,
        });
        return reply.send(ProviderBrokerRequestAdmissionResponseV1Schema.parse(result));
    });
}
