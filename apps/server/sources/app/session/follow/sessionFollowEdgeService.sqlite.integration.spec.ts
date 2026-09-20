import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeBase64, MACHINE_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';

import { db } from '@/storage/db';
import { inTx, type Tx } from '@/storage/inTx';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { transitionSessionArchiveStateInTx } from '@/app/session/archive/transitionSessionArchiveStateInTx';
import { createPresentUserSessionAccessAuthentication } from '@/app/session/access/sessionAccessAuthentication.testkit';
import { eventRouter } from '@/app/events/eventRouter';
import { markSessionProjectionRecipientsChanged } from '@/app/session/changeTracking/markSessionProjectionRecipientsChanged';

import {
    acknowledgeSessionFollowFrontierInTx,
    authorizeSessionFollowSourceKeyPreparation as authorizeSessionFollowSourceKeyPreparationAuthenticated,
    listSessionFollowSources as listSessionFollowSourcesAuthenticated,
    observePendingSessionFollowForDestinationInTx as observeSessionFollowForDestinationInTx,
    projectSessionFollowSourceForRunnerInTx,
    removeUnsafeSessionFollowEdgesForAccessChangeInTx,
    removeSessionFollowSource as removeSessionFollowSourceAuthenticated,
    setSessionFollowSource as setSessionFollowSourceAuthenticated,
} from './sessionFollowEdgeService';

const authentication = createPresentUserSessionAccessAuthentication({ env: {} });

// Most assertions in this file predate authoritative membership being returned
// beside delivery deltas. Keep them focused on pending delivery; membership has
// its own discriminating lifecycle assertion below.
const observePendingSessionFollowForDestinationInTx = async (
    ...args: Parameters<typeof observeSessionFollowForDestinationInTx>
) => (await observeSessionFollowForDestinationInTx(...args)).observations;

const listSessionFollowSources = (
    input: Omit<Parameters<typeof listSessionFollowSourcesAuthenticated>[0], 'authentication'>,
) => listSessionFollowSourcesAuthenticated({ ...input, authentication });

const setSessionFollowSource = (
    input: Omit<Parameters<typeof setSessionFollowSourceAuthenticated>[0], 'authentication'>,
) => setSessionFollowSourceAuthenticated({ ...input, authentication });

const removeSessionFollowSource = (
    input: Omit<Parameters<typeof removeSessionFollowSourceAuthenticated>[0], 'authentication'>,
) => removeSessionFollowSourceAuthenticated({ ...input, authentication });

const authorizeSessionFollowSourceKeyPreparation = (
    input: Omit<Parameters<typeof authorizeSessionFollowSourceKeyPreparationAuthenticated>[0], 'authentication'>,
) => authorizeSessionFollowSourceKeyPreparationAuthenticated({ ...input, authentication });

async function createAccount() {
    return await db.account.create({ data: { publicKey: `pk-${randomUUID()}`, encryptionMode: 'plain' } });
}

async function createSession(accountId: string, overrides: Record<string, unknown> = {}) {
    return await db.session.create({
        data: {
            accountId,
            tag: `s-${randomUUID()}`,
            metadata: '{}',
            encryptionMode: 'plain',
            ...overrides,
        },
    });
}

async function grantAccess(
    session: { id: string; accountId: string },
    accountId: string,
    accessLevel: 'view' | 'edit' | 'admin',
) {
    await db.sessionShare.create({
        data: {
            session: { connect: { id: session.id } },
            sharedByUser: { connect: { id: session.accountId } },
            sharedWithUser: { connect: { id: accountId } },
            accessLevel,
        },
    });
}

async function readEdge(destinationSessionId: string, sourceSessionId: string) {
    return await db.sessionFollowEdge.findUnique({
        where: { destinationSessionId_sourceSessionId: { destinationSessionId, sourceSessionId } },
    });
}

async function loadPublisherGeneration(sessionId: string): Promise<bigint> {
    const row = await db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { publisherGeneration: true } });
    return row.publisherGeneration;
}

/** The verified destination-runtime principal for the service's runtime lanes. */
const runtimePrincipal = (accountId: string) => ({
    kind: 'destination_runtime',
    destinationRuntimeAccountId: accountId,
    authentication,
}) as const;

const SEEDED_SOURCE = {
    seq: 5,
    latestReadyEventSeq: 3,
    agentStateVersion: 2,
    latestTurnId: 'turn-a',
    latestTurnStatus: 'completed',
} as const;

describe('SessionFollowEdge service', () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: 'happier-session-follow-edge-',
            env: { HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED: 'true' },
        });
    }, 180_000);

    afterEach(async () => {
        eventRouter.clearIo();
        await db.sessionFollowEdge.deleteMany();
        await db.accessKey.deleteMany();
        await db.ephemeralRunnerActivation.deleteMany();
        await db.machine.deleteMany();
        await db.sessionShare.deleteMany();
        await db.sessionMessage.deleteMany();
        await db.session.deleteMany();
        await db.team.deleteMany();
        await db.account.deleteMany();
    });

    it('publishes one exact content-free destination invalidation after a source projection commit', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        const unrelated = await createSession(owner.id);
        await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        });

        const exactEmit = vi.fn();
        const wrongSessionEmit = vi.fn();
        const exact = {
            connectionType: 'session-scoped' as const,
            userId: owner.id,
            sessionId: destination.id,
            socket: { id: 'runner-exact', data: { authAuthority: 'present_user' }, emit: exactEmit },
        };
        const wrongSession = {
            connectionType: 'session-scoped' as const,
            userId: owner.id,
            sessionId: unrelated.id,
            socket: { id: 'runner-wrong-session', data: { authAuthority: 'present_user' }, emit: wrongSessionEmit },
        };
        // The destination broadcast is scheduled fire-and-forget
        // (`void eventRouter.emitSessionBroadcast(...)` in an after-commit
        // callback `inTx` invokes synchronously), so `vi.waitFor` resolving on
        // the first delivery does not mean the commit's fan-out has finished.
        // Settle the emitter's own promises to a fixpoint rather than waiting a
        // guessed interval: anything still in flight would otherwise land after
        // `mockClear()` and read as an emission from the rolled-back commit.
        const broadcast = vi.spyOn(eventRouter, 'emitSessionBroadcast');
        const settleBroadcasts = async () => {
            for (let settled = -1; settled !== broadcast.mock.results.length;) {
                settled = broadcast.mock.results.length;
                await Promise.all(broadcast.mock.results.map(
                    (result) => result.type === 'return' ? result.value : undefined,
                ));
            }
        };
        eventRouter.addConnection(owner.id, exact as never);
        eventRouter.addConnection(owner.id, wrongSession as never);
        try {
            await inTx(async (tx) => {
                await markSessionProjectionRecipientsChanged({ tx, sessionId: source.id });
            });
            await vi.waitFor(() => expect(exactEmit).toHaveBeenCalledWith('session', expect.objectContaining({
                body: { t: 'session-changed', sessionId: destination.id },
            })));
            await settleBroadcasts();
            expect(wrongSessionEmit).not.toHaveBeenCalled();

            exactEmit.mockClear();
            await expect(inTx(async (tx) => {
                await markSessionProjectionRecipientsChanged({ tx, sessionId: source.id });
                throw new Error('rollback');
            })).rejects.toThrow('rollback');
            await settleBroadcasts();
            expect(exactEmit).not.toHaveBeenCalled();
        } finally {
            broadcast.mockRestore();
            eventRouter.removeConnection(owner.id, exact as never);
            eventRouter.removeConnection(owner.id, wrongSession as never);
        }
    });

    afterAll(async () => {
        if (harness) await harness.close();
    });

    it.each(['plain', 'e2ee'] as const)(
        'projects only the current edge-delivered to server-observed transcript range for a %s source and the current materialized Runner tuple',
        async (encryptionMode) => {
        const owner = await createAccount();
        const source = await createSession(owner.id, { seq: 2, encryptionMode });
        const sibling = await createSession(owner.id, { seq: 2 });
        const destination = await createSession(owner.id);
        await setSessionFollowSource({ accountId: owner.id, sourceSessionId: source.id, destinationSessionId: destination.id });
        await db.sessionMessage.create({ data: {
            sessionId: source.id,
            seq: 2,
            content: encryptionMode === 'plain'
                ? { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'bounded' } } }
                : { t: 'encrypted', c: 'Ym91bmRlZA' },
        } });
        const publicKey = new Uint8Array(32).fill(7);
        const machine = await db.machine.create({ data: {
            id: `runner-${randomUUID()}`, accountId: owner.id, metadata: '{}', kind: 'ephemeral_session_runner',
            installationId: 'runner-installation', installationPublicKey: publicKey,
        } });
        await db.accessKey.create({ data: { accountId: owner.id, machineId: machine.id, sessionId: destination.id, data: 'opaque' } });
        const activationId = randomUUID();
        await db.ephemeralRunnerActivation.create({ data: {
            id: activationId, creatorAccountId: owner.id, creatorTokenEpoch: owner.tokenEpoch, draftId: `draft-${randomUUID()}`,
            sessionId: destination.id, machineId: machine.id, state: 'materialized', workspacePolicy: 'choose_on_endpoint', homeServerIdentityId: 'home',
            activationSigningPublicKey: 'a'.repeat(43), authoringCommitment: 'b'.repeat(43),
            artifact: {}, endpointFactsRecipient: {},
        } });
        const principal = {
            kind: 'ephemeral_session_runner' as const, authority: 'session_runtime' as const, accountId: owner.id,
            activationId, sessionId: destination.id, machineId: machine.id, installationId: 'runner-installation',
            installationPublicKey: encodeBase64(publicKey, 'base64url'), creatorTokenEpoch: owner.tokenEpoch,
        };
        const historicalRequest = { v: 1 as const, sourceSessionId: source.id, afterTranscriptSeq: 1, observedTranscriptSeq: 2, limit: 20 };

        // The edge was seeded at source seq=2. A Runner must not widen the
        // lower bound to replay history that predates the Follow relation.
        await expect(inTx((tx) => projectSessionFollowSourceForRunnerInTx(tx, {
            principal, destinationSessionId: destination.id, request: historicalRequest,
        }))).resolves.toBeNull();
        // Nor may it widen the upper bound beyond the source frontier that the
        // server can currently observe for this edge.
        await expect(inTx((tx) => projectSessionFollowSourceForRunnerInTx(tx, {
            principal,
            destinationSessionId: destination.id,
            request: { ...historicalRequest, afterTranscriptSeq: 2, observedTranscriptSeq: 3 },
        }))).resolves.toBeNull();
        await expect(inTx((tx) => projectSessionFollowSourceForRunnerInTx(tx, {
            principal, destinationSessionId: destination.id, request: { ...historicalRequest, sourceSessionId: sibling.id },
        }))).resolves.toBeNull();
        await db.sessionMessage.create({ data: {
            sessionId: source.id,
            seq: 3,
            content: encryptionMode === 'plain'
                ? { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'current' } } }
                : { t: 'encrypted', c: 'Y3VycmVudA' },
        } });
        await db.session.update({ where: { id: source.id }, data: { seq: 3 } });
        await expect(inTx((tx) => observeSessionFollowForDestinationInTx(tx, {
            principal,
            destinationSessionId: destination.id,
        }))).resolves.toMatchObject({
            currentSourceSessionIds: [source.id],
            observations: [{ sourceSessionId: source.id, observed: { transcriptSeq: 3 } }],
        });
        await expect(inTx((tx) => projectSessionFollowSourceForRunnerInTx(tx, {
            principal,
            destinationSessionId: destination.id,
            request: { ...historicalRequest, afterTranscriptSeq: 2, observedTranscriptSeq: 2 },
        }))).resolves.toMatchObject({ source: { id: source.id }, messages: [], hasMore: false });
        await expect(inTx((tx) => projectSessionFollowSourceForRunnerInTx(tx, {
            principal,
            destinationSessionId: destination.id,
            request: { ...historicalRequest, afterTranscriptSeq: 3, observedTranscriptSeq: 3 },
        }))).resolves.toBeNull();
        const request = { ...historicalRequest, afterTranscriptSeq: 2, observedTranscriptSeq: 3 };
        await expect(inTx((tx) => projectSessionFollowSourceForRunnerInTx(tx, {
            principal, destinationSessionId: destination.id, request,
        }))).resolves.toMatchObject({ source: { id: source.id }, messages: [{ seq: 3 }], hasMore: false });

        // If another accepted input advances the edge before this projection
        // request arrives, the stale request must not replay that consumed row.
        await db.sessionFollowEdge.update({
            where: { destinationSessionId_sourceSessionId: {
                destinationSessionId: destination.id,
                sourceSessionId: source.id,
            } },
            data: { deliveredTranscriptSeq: 3 },
        });
        await expect(inTx((tx) => projectSessionFollowSourceForRunnerInTx(tx, {
            principal, destinationSessionId: destination.id, request,
        }))).resolves.toBeNull();
        await db.machine.update({ where: { id: machine.id }, data: { revokedAt: new Date() } });
        await expect(inTx((tx) => projectSessionFollowSourceForRunnerInTx(tx, { principal, destinationSessionId: destination.id, request })))
            .resolves.toBeNull();
        await expect(inTx((tx) => observeSessionFollowForDestinationInTx(tx, {
            principal,
            destinationSessionId: destination.id,
        }))).resolves.toEqual({ currentSourceSessionIds: [], observations: [] });
        await expect(inTx((tx) => acknowledgeSessionFollowFrontierInTx(tx, {
            principal,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
            expectedPublisherGeneration: destination.publisherGeneration,
            expected: { transcriptSeq: 2, readyEventSeq: 0, agentStateVersion: 0, turn: null },
            observed: { transcriptSeq: 3, readyEventSeq: 0, agentStateVersion: 0, turn: null },
            consumed: { transcriptSeq: 3, readyEventSeq: 0, agentStateVersion: 0, turn: null },
            acceptance: { kind: 'admitted_input', localInputId: 'runner-input', userMessageSeq: null },
        }))).resolves.toEqual({ ok: false, rejection: 'source_forbidden' });
    });


    it('rejects partial or invalid persisted terminal-turn frontiers', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);

        await expect(db.$executeRaw`
            INSERT INTO SessionFollowEdge (
                sourceSessionId,
                destinationSessionId,
                deliveredTurnId,
                deliveredTurnStatus
            ) VALUES (${source.id}, ${destination.id}, ${'turn-without-status'}, NULL)
        `).rejects.toThrow();

        await expect(db.$executeRaw`
            INSERT INTO SessionFollowEdge (
                sourceSessionId,
                destinationSessionId,
                deliveredTurnId,
                deliveredTurnStatus
            ) VALUES (${source.id}, ${destination.id}, NULL, ${'completed'})
        `).rejects.toThrow();

        await expect(db.$executeRaw`
            INSERT INTO SessionFollowEdge (
                sourceSessionId,
                destinationSessionId,
                deliveredTurnId,
                deliveredTurnStatus
            ) VALUES (${source.id}, ${destination.id}, ${'turn-invalid-status'}, ${'running'})
        `).rejects.toThrow();

        expect(await readEdge(destination.id, source.id)).toBeNull();
    });

    it('rejects a persisted self-follow edge', async () => {
        const owner = await createAccount();
        const session = await createSession(owner.id);

        await expect(db.$executeRaw`
            INSERT INTO SessionFollowEdge (
                sourceSessionId,
                destinationSessionId
            ) VALUES (${session.id}, ${session.id})
        `).rejects.toThrow();

        expect(await readEdge(session.id, session.id)).toBeNull();
    });

    it.each([
        'deliveredTranscriptSeq',
        'deliveredReadyEventSeq',
        'deliveredAgentStateVersion',
    ] as const)('rejects a negative persisted %s', async (column) => {
        const owner = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);

        await expect(db.$executeRawUnsafe(
            `INSERT INTO SessionFollowEdge (sourceSessionId, destinationSessionId, ${column}) VALUES (?, ?, -1)`,
            source.id,
            destination.id,
        )).rejects.toThrow();

        expect(await readEdge(destination.id, source.id)).toBeNull();
    });

    it('seeds every delivered component from the current source frontier so enabling Follow delivers no history', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id, SEEDED_SOURCE);
        const destination = await createSession(owner.id);

        const result = await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        });

        expect(result).toEqual({
            ok: true,
            value: {
                changed: true,
                source: {
                    sourceSessionId: source.id,
                    destinationSessionId: destination.id,
                    mode: 'next_turn',
                    deliveryState: 'eligible',
                    hasPendingUpdates: false,
                },
            },
        });
        expect(await readEdge(destination.id, source.id)).toMatchObject({
            deliveredTranscriptSeq: 5,
            deliveredReadyEventSeq: 3,
            deliveredAgentStateVersion: 2,
            deliveredTurnId: 'turn-a',
            deliveredTurnStatus: 'completed',
        });
        expect(await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }))).toEqual([]);
    });

    it('admits key preparation only for the current edge and exact ephemeral destination AccessKey', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        await setSessionFollowSource({ accountId: owner.id, sourceSessionId: source.id, destinationSessionId: destination.id });
        const installationId = `installation-${randomUUID()}`;
        const installationPublicKey = new Uint8Array(32).fill(9);
        const runner = await db.machine.create({ data: {
            id: `runner-${randomUUID()}`,
            accountId: owner.id,
            kind: 'ephemeral_session_runner',
            metadata: '{}',
            dataEncryptionKey: new Uint8Array([1]),
            runnerContentKeyBinding: {},
            installationId,
            installationPublicKey,
        } });
        const persistent = await db.machine.create({ data: {
            id: `persistent-${randomUUID()}`,
            accountId: owner.id,
            kind: 'persistent',
            metadata: '{}',
        } });
        await db.accessKey.create({ data: {
            accountId: owner.id,
            machineId: runner.id,
            sessionId: destination.id,
            data: 'opaque',
        } });

        const activationId = randomUUID();
        const principal = {
            kind: 'ephemeral_session_runner' as const,
            authority: 'session_runtime' as const,
            accountId: owner.id,
            activationId,
            sessionId: destination.id,
            machineId: runner.id,
            installationId,
            installationPublicKey: encodeBase64(installationPublicKey, 'base64url'),
            creatorTokenEpoch: owner.tokenEpoch,
        };
        await expect(authorizeSessionFollowSourceKeyPreparation({
            accountId: owner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            principal,
        })).resolves.toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        await db.ephemeralRunnerActivation.create({ data: {
            id: activationId, creatorAccountId: owner.id, creatorTokenEpoch: owner.tokenEpoch, draftId: `draft-${randomUUID()}`,
            sessionId: destination.id, machineId: runner.id, state: 'materialized', workspacePolicy: 'choose_on_endpoint', homeServerIdentityId: 'home',
            activationSigningPublicKey: 'a'.repeat(43), authoringCommitment: 'b'.repeat(43),
            artifact: {}, endpointFactsRecipient: {},
        } });
        await expect(authorizeSessionFollowSourceKeyPreparation({
            accountId: owner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            principal,
        })).resolves.toMatchObject({ ok: true, value: { destinationRuntimeAccountId: owner.id, machineId: runner.id } });
        await db.account.update({ where: { id: owner.id }, data: { tokenEpoch: { increment: 1 } } });
        await expect(authorizeSessionFollowSourceKeyPreparation({
            accountId: owner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            principal,
        })).resolves.toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        await db.account.update({ where: { id: owner.id }, data: { tokenEpoch: principal.creatorTokenEpoch } });
        await expect(authorizeSessionFollowSourceKeyPreparation({
            accountId: owner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            principal: { ...principal, installationId: `sibling-${installationId}` },
        })).resolves.toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        await db.machine.update({
            where: { id: runner.id },
            data: {
                dataEncryptionKey: new Uint8Array(Buffer.from(MACHINE_PLAIN_DATA_KEY_MARKER, 'base64')),
            },
        });
        await expect(authorizeSessionFollowSourceKeyPreparation({
            accountId: owner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            principal,
        })).resolves.toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        await db.machine.update({
            where: { id: runner.id },
            data: { dataEncryptionKey: new Uint8Array([1]), runnerContentKeyBinding: {} },
        });
        await expect(authorizeSessionFollowSourceKeyPreparation({
            accountId: owner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            principal: { ...principal, machineId: persistent.id },
        })).resolves.toEqual({ ok: false, error: 'session_follow_source_forbidden' });

        await db.accessKey.deleteMany({ where: { machineId: runner.id } });
        await expect(authorizeSessionFollowSourceKeyPreparation({
            accountId: owner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            principal,
        })).resolves.toEqual({ ok: false, error: 'session_follow_source_forbidden' });
    });

    it('rejects an authorized edge author who cannot address the destination Account Machine', async () => {
        const sourceOwner = await createAccount();
        const destinationOwner = await createAccount();
        const source = await createSession(sourceOwner.id);
        const destination = await createSession(destinationOwner.id);
        await grantAccess(source, destinationOwner.id, 'view');
        await grantAccess(destination, sourceOwner.id, 'edit');
        await setSessionFollowSource({
            accountId: sourceOwner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
        });
        const installationId = `installation-${randomUUID()}`;
        const installationPublicKey = new Uint8Array(32).fill(8);
        const runner = await db.machine.create({ data: {
            id: `runner-${randomUUID()}`,
            accountId: destinationOwner.id,
            kind: 'ephemeral_session_runner',
            metadata: '{}',
            dataEncryptionKey: new Uint8Array([1]),
            runnerContentKeyBinding: {},
            installationId,
            installationPublicKey,
        } });
        await db.accessKey.create({ data: {
            accountId: destinationOwner.id,
            machineId: runner.id,
            sessionId: destination.id,
            data: 'opaque',
        } });

        const activationId = randomUUID();
        await db.ephemeralRunnerActivation.create({ data: {
            id: activationId,
            creatorAccountId: destinationOwner.id,
            creatorTokenEpoch: destinationOwner.tokenEpoch,
            draftId: `draft-${randomUUID()}`,
            sessionId: destination.id,
            machineId: runner.id,
            state: 'materialized',
            workspacePolicy: 'choose_on_endpoint',
            homeServerIdentityId: 'home',
            activationSigningPublicKey: 'a'.repeat(43),
            authoringCommitment: 'b'.repeat(43),
            artifact: {},
            endpointFactsRecipient: {},
        } });

        await expect(authorizeSessionFollowSourceKeyPreparation({
            accountId: sourceOwner.id,
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            principal: {
                kind: 'ephemeral_session_runner',
                authority: 'session_runtime',
                accountId: destinationOwner.id,
                activationId,
                sessionId: destination.id,
                machineId: runner.id,
                installationId,
                installationPublicKey: encodeBase64(installationPublicKey, 'base64url'),
                creatorTokenEpoch: destinationOwner.tokenEpoch,
            },
        })).resolves.toEqual({ ok: false, error: 'session_follow_source_forbidden' });
    });

    it('treats a null ready sequence as the pre-ready zero frontier and the first positive sequence as pending', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id, { latestReadyEventSeq: null });
        const destination = await createSession(owner.id);

        await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        });
        expect(await readEdge(destination.id, source.id)).toMatchObject({ deliveredReadyEventSeq: 0 });
        expect(await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }))).toEqual([]);

        await db.session.update({ where: { id: source.id }, data: { latestReadyEventSeq: 1 } });
        const pending = await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }));
        expect(pending).toHaveLength(1);
        expect(pending[0]?.observed.readyEventSeq).toBe(1);
    });

    it('rejects the same Session, unreadable endpoints, missing destination input, archived endpoints and a denied pairwise flow', async () => {
        const owner = await createAccount();
        const stranger = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        const archived = await createSession(owner.id, { archivedAt: new Date() });

        expect(await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: destination.id,
        })).toEqual({ ok: false, error: 'session_follow_same_session' });

        expect(await setSessionFollowSource({
            accountId: stranger.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        })).toEqual({ ok: false, error: 'session_not_found' });

        // Readable source and destination, but only `view` on the destination:
        // the destination-input capability is missing, so this is a forbidden
        // flow rather than a concealed Session.
        const viewer = await createAccount();
        await grantAccess(source, viewer.id, 'view');
        await grantAccess(destination, viewer.id, 'view');
        expect(await setSessionFollowSource({
            accountId: viewer.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        })).toEqual({ ok: false, error: 'session_follow_source_forbidden' });

        expect(await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: archived.id,
            sourceSessionId: source.id,
        })).toEqual({ ok: false, error: 'session_archived' });

        await grantAccess(destination, stranger.id, 'view');
        expect(await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        })).toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        expect(await readEdge(destination.id, source.id)).toBeNull();
    });

    it('denies a destination whose derived runtime Account cannot read the source even when the author can read both', async () => {
        const sourceOwner = await createAccount();
        const destinationOwner = await createAccount();
        const source = await createSession(sourceOwner.id);
        const destination = await createSession(destinationOwner.id);
        // The configuring author can read the source and drive the destination,
        // but the destination's own runtime Account has no source access.
        await grantAccess(source, destinationOwner.id, 'view');
        await grantAccess(destination, sourceOwner.id, 'edit');
        await grantAccess(source, sourceOwner.id, 'view');

        expect(await setSessionFollowSource({
            accountId: sourceOwner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        })).toMatchObject({ ok: true });

        await db.sessionShare.deleteMany({ where: { sessionId: source.id, sharedWithUserId: destinationOwner.id } });
        await db.sessionFollowEdge.deleteMany();

        expect(await setSessionFollowSource({
            accountId: sourceOwner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        })).toEqual({ ok: false, error: 'session_follow_source_forbidden' });
    });

    it('rejects a broader destination audience even when the author and destination runtime can read the source', async () => {
        const owner = await createAccount();
        const reader = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        await grantAccess(destination, reader.id, 'view');

        expect(await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        })).toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        expect(await readEdge(destination.id, source.id)).toBeNull();
    });

    it('rechecks a saved pair after audience broadening and permits safe contraction without reseeding it', async () => {
        const owner = await createAccount();
        const reader = await createAccount();
        const source = await createSession(owner.id, SEEDED_SOURCE);
        const destination = await createSession(owner.id);
        const input = {
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        };
        expect(await setSessionFollowSource(input)).toMatchObject({ ok: true, value: { changed: true } });
        await db.session.update({ where: { id: source.id }, data: { seq: 20 } });
        await grantAccess(destination, reader.id, 'view');
        expect(await setSessionFollowSource(input)).toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        expect(await readEdge(destination.id, source.id)).toMatchObject({ deliveredTranscriptSeq: 5 });

        await db.sessionShare.deleteMany({ where: { sessionId: destination.id, sharedWithUserId: reader.id } });
        expect(await setSessionFollowSource(input)).toMatchObject({ ok: true, value: { changed: false } });
        expect(await readEdge(destination.id, source.id)).toMatchObject({ deliveredTranscriptSeq: 5 });
    });

    it('checks destination readers beyond the first bounded audience page', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        const readers = Array.from({ length: 150 }, () => ({ id: `audience-${randomUUID()}`, publicKey: randomUUID(), encryptionMode: 'plain' as const }));
        const lastReader = { id: `zz-reader-${randomUUID()}`, publicKey: randomUUID(), encryptionMode: 'plain' as const };
        await db.account.createMany({ data: [...readers, lastReader] });
        await db.sessionShare.createMany({ data: [
            ...readers.flatMap(({ id }) => [source, destination].map((session) => ({
                sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: id, accessLevel: 'view' as const,
            }))),
            { sessionId: destination.id, sharedByUserId: owner.id, sharedWithUserId: lastReader.id, accessLevel: 'view' as const },
        ] });
        expect(await setSessionFollowSource({
            accountId: owner.id, destinationSessionId: destination.id, sourceSessionId: source.id,
        })).toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        expect(await readEdge(destination.id, source.id)).toBeNull();
    });

    it('admits an editor with source read without access management or source-key readiness', async () => {
        const sourceOwner = await createAccount();
        await db.account.update({ where: { id: sourceOwner.id }, data: { encryptionMode: 'e2ee' } });
        const destinationOwner = await createAccount();
        const editor = await createAccount();
        const source = await createSession(sourceOwner.id, { encryptionMode: 'e2ee' });
        const destination = await createSession(destinationOwner.id);
        await grantAccess(source, destinationOwner.id, 'view');
        await grantAccess(source, editor.id, 'view');
        await grantAccess(destination, editor.id, 'edit');

        expect(await setSessionFollowSource({
            accountId: editor.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        })).toMatchObject({ ok: true, value: { changed: true } });
        expect(await db.sessionShare.count()).toBe(3);
    });

    it('rejects a Team destination reader whose membership horizon excludes the source grant', async () => {
        const owner = await createAccount();
        const member = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        const team = await db.team.create({ data: { name: randomUUID() } });
        const cutoff = new Date('2026-09-01T12:00:00.000Z');
        await db.teamMembership.create({ data: {
            teamId: team.id, accountId: member.id, role: 'member', sessionAccessStartsAt: cutoff,
        } });
        await db.sessionTeamGrant.create({ data: {
            sessionId: source.id, teamId: team.id, effectiveAt: cutoff, accessLevel: 'view',
        } });
        await db.sessionTeamGrant.create({ data: {
            sessionId: destination.id, teamId: team.id, effectiveAt: new Date(cutoff.getTime() + 1), accessLevel: 'view',
        } });
        const input = {
            accountId: owner.id, destinationSessionId: destination.id, sourceSessionId: source.id,
        };
        expect(await setSessionFollowSource(input)).toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        expect(await readEdge(destination.id, source.id)).toBeNull();
        await grantAccess(source, member.id, 'view');
        expect(await setSessionFollowSource(input)).toMatchObject({ ok: true });
    });

    it('includes exact Group-granted guests and uses their Group horizon independently of the containing Team', async () => {
        const owner = await createAccount();
        const guest = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        const team = await db.team.create({ data: { name: randomUUID() } });
        const cutoff = new Date('2026-09-01T12:00:00.000Z');
        const membership = await db.teamMembership.create({ data: {
            teamId: team.id, accountId: guest.id, role: 'guest', sessionAccessStartsAt: cutoff,
        } });
        const group = await db.teamGroup.create({ data: { teamId: team.id, name: 'Guests', nameKey: 'guests' } });
        await db.teamGroupMembership.create({ data: {
            teamId: team.id, teamGroupId: group.id, teamMembershipId: membership.id,
            nativeContribution: true, sessionAccessStartsAt: null,
        } });
        await db.sessionTeamGrant.create({ data: {
            sessionId: source.id, teamId: team.id, effectiveAt: new Date(cutoff.getTime() + 1), accessLevel: 'view',
        } });
        await db.sessionGroupGrant.create({ data: {
            sessionId: destination.id, teamGroupId: group.id, effectiveAt: cutoff, accessLevel: 'view',
        } });
        const input = {
            accountId: owner.id, destinationSessionId: destination.id, sourceSessionId: source.id,
        };
        expect(await setSessionFollowSource(input)).toEqual({ ok: false, error: 'session_follow_source_forbidden' });
        await db.sessionGroupGrant.create({ data: {
            sessionId: source.id, teamGroupId: group.id,
            effectiveAt: new Date(cutoff.getTime() - 1), accessLevel: 'view',
        } });
        expect(await setSessionFollowSource(input)).toMatchObject({ ok: true });
    });

    it('is idempotent for repeated set and for removing an absent edge, and never grants source read on removal', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id, SEEDED_SOURCE);
        const destination = await createSession(owner.id);
        const args = {
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        };

        const accountSeqBeforeCreate = (await db.account.findUniqueOrThrow({ where: { id: owner.id } })).seq;
        expect(await setSessionFollowSource(args)).toMatchObject({ ok: true, value: { changed: true } });
        expect(await db.accountChange.findUnique({ where: { accountId_kind_entityId: {
            accountId: owner.id, kind: 'session', entityId: destination.id,
        } } })).toMatchObject({ cursor: accountSeqBeforeCreate + 1 });
        await db.session.update({ where: { id: source.id }, data: { seq: 42 } });
        expect(await setSessionFollowSource(args)).toMatchObject({ ok: true, value: { changed: false } });
        expect((await db.account.findUniqueOrThrow({ where: { id: owner.id } })).seq).toBe(accountSeqBeforeCreate + 1);
        // A repeated set must not reseed: the pending delta stays deliverable.
        expect(await readEdge(destination.id, source.id)).toMatchObject({ deliveredTranscriptSeq: 5 });

        const removeArgs = {
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        };
        expect(await removeSessionFollowSource(removeArgs)).toEqual({ ok: true, value: { changed: true } });
        expect((await db.account.findUniqueOrThrow({ where: { id: owner.id } })).seq).toBe(accountSeqBeforeCreate + 2);
        expect(await removeSessionFollowSource(removeArgs)).toEqual({ ok: true, value: { changed: false } });
        expect((await db.account.findUniqueOrThrow({ where: { id: owner.id } })).seq).toBe(accountSeqBeforeCreate + 2);
    });

    it('invalidates the exact destination Session once for an actual mode change', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        const args = {
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        };

        expect(await setSessionFollowSource(args)).toMatchObject({ ok: true, value: { changed: true } });
        const seqAfterCreate = (await db.account.findUniqueOrThrow({ where: { id: owner.id } })).seq;
        expect(await setSessionFollowSource({ ...args, mode: 'wake_on_human_change' })).toMatchObject({
            ok: true,
            value: { changed: true, source: { mode: 'wake_on_human_change' } },
        });
        expect((await db.account.findUniqueOrThrow({ where: { id: owner.id } })).seq).toBe(seqAfterCreate + 1);
        expect(await db.accountChange.findUnique({ where: { accountId_kind_entityId: {
            accountId: owner.id, kind: 'session', entityId: destination.id,
        } } })).toMatchObject({ cursor: seqAfterCreate + 1 });

        expect(await setSessionFollowSource({ ...args, mode: 'wake_on_human_change' })).toMatchObject({
            ok: true,
            value: { changed: false },
        });
        expect((await db.account.findUniqueOrThrow({ where: { id: owner.id } })).seq).toBe(seqAfterCreate + 1);
    });

    it('converges concurrent first writers on one seeded edge', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id, SEEDED_SOURCE);
        const destination = await createSession(owner.id);
        const args = {
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        };

        const results = await Promise.all([
            setSessionFollowSource(args),
            setSessionFollowSource(args),
        ]);

        expect(results.every((result) => result.ok)).toBe(true);
        expect(results.filter((result) => result.ok && result.value.changed)).toHaveLength(1);
        expect((await db.account.findUniqueOrThrow({ where: { id: owner.id } })).seq).toBe(1);
        expect(await db.sessionFollowEdge.count({ where: {
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        } })).toBe(1);
        expect(await readEdge(destination.id, source.id)).toMatchObject({
            deliveredTranscriptSeq: SEEDED_SOURCE.seq,
            deliveredReadyEventSeq: SEEDED_SOURCE.latestReadyEventSeq,
            deliveredAgentStateVersion: SEEDED_SOURCE.agentStateVersion,
            deliveredTurnId: SEEDED_SOURCE.latestTurnId,
            deliveredTurnStatus: SEEDED_SOURCE.latestTurnStatus,
        });
    });

    it('rejects mutations from a suspended Account after authentication', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        await db.account.update({ where: { id: owner.id }, data: { status: 'suspended' } });

        expect(await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        })).toEqual({ ok: false, error: 'account_inactive' });
        expect(await listSessionFollowSources({ accountId: owner.id, destinationSessionId: destination.id }))
            .toEqual({ ok: false, error: 'account_inactive' });
    });

    it('lists only sources the caller can still read and marks archived pairs paused', async () => {
        const owner = await createAccount();
        const collaborator = await createAccount();
        const readable = await createSession(owner.id);
        const secret = await createSession(owner.id);
        const destination = await createSession(owner.id);
        await grantAccess(destination, collaborator.id, 'edit');
        await grantAccess(readable, collaborator.id, 'view');
        await grantAccess(secret, collaborator.id, 'view');
        for (const source of [readable, secret]) {
            await setSessionFollowSource({
                accountId: owner.id,
                destinationSessionId: destination.id,
                sourceSessionId: source.id,
            });
        }

        await db.sessionShare.deleteMany({ where: { sessionId: secret.id, sharedWithUserId: collaborator.id } });

        const collaboratorView = await listSessionFollowSources({
            accountId: collaborator.id,
            destinationSessionId: destination.id,
        });
        expect(collaboratorView).toMatchObject({ ok: true });
        expect(collaboratorView.ok && collaboratorView.value.map((entry) => entry.sourceSessionId)).toEqual([readable.id]);

        await db.session.update({ where: { id: readable.id }, data: { seq: { increment: 1 } } });
        const pendingView = await listSessionFollowSources({
            accountId: collaborator.id,
            destinationSessionId: destination.id,
        });
        expect(pendingView.ok && pendingView.value[0]?.hasPendingUpdates).toBe(true);

        await db.session.update({ where: { id: readable.id }, data: { archivedAt: new Date() } });
        const archivedView = await listSessionFollowSources({
            accountId: collaborator.id,
            destinationSessionId: destination.id,
        });
        expect(archivedView.ok && archivedView.value[0]?.deliveryState).toBe('paused_archived');
        expect(archivedView.ok && archivedView.value[0]?.hasPendingUpdates).toBe(true);
    });

    it('observes an exact terminal-turn change but ignores a timestamp-only change, and stays silent while archived', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id, SEEDED_SOURCE);
        const destination = await createSession(owner.id);
        await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        });

        await db.session.update({ where: { id: source.id }, data: { latestTurnStatusObservedAt: BigInt(Date.now()) } });
        expect(await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }))).toEqual([]);

        await db.session.update({ where: { id: source.id }, data: { latestTurnId: 'turn-b' } });
        const pending = await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }));
        expect(pending).toHaveLength(1);
        expect(pending[0]?.observed.turn).toEqual({ id: 'turn-b', status: 'completed' });
        expect(pending[0]?.delivered.turn).toEqual({ id: 'turn-a', status: 'completed' });

        await db.session.update({ where: { id: source.id }, data: { archivedAt: new Date() } });
        expect(await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }))).toEqual([]);
    });

    it('advances the frontier only through an exact compare-and-set and refuses stale, duplicated or over-reaching acknowledgments', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id, SEEDED_SOURCE);
        const destination = await createSession(owner.id);
        await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        });
        await db.session.update({
            where: { id: source.id },
            data: { seq: 9, latestReadyEventSeq: 4, latestTurnId: 'turn-b', latestTurnStatus: 'failed' },
        });

        const expected = { transcriptSeq: 5, readyEventSeq: 3, agentStateVersion: 2, turn: { id: 'turn-a', status: 'completed' as const } };
        const consumed = { transcriptSeq: 9, readyEventSeq: 4, agentStateVersion: 2, turn: { id: 'turn-b', status: 'failed' as const } };
        const generation = await loadPublisherGeneration(destination.id);
        await db.sessionMessage.create({ data: {
            sessionId: destination.id,
            seq: 1,
            localId: 'accepted-follow-input',
            messageRole: 'user',
            content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'continue' } } },
            inputAdmissionReceipt: { v: 1, issuer: 'authenticatedAccount', actorAccountId: owner.id, sessionRelationship: 'owner' },
        } });
        const base = {
            principal: runtimePrincipal(owner.id),
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
            expectedPublisherGeneration: generation,
            observed: consumed,
            acceptance: { kind: 'admitted_input', localInputId: 'accepted-follow-input', userMessageSeq: 1 } as const,
        };

        expect(await inTx((tx: Tx) => acknowledgeSessionFollowFrontierInTx(tx, {
            ...base,
            expected,
            observed: { ...consumed, transcriptSeq: 8 },
            consumed,
        }))).toEqual({ ok: false, rejection: 'invalid_consumed_frontier' });

        expect(await inTx((tx: Tx) => acknowledgeSessionFollowFrontierInTx(tx, {
            ...base,
            expected,
            consumed: { ...consumed, transcriptSeq: 40 },
        }))).toEqual({ ok: false, rejection: 'invalid_consumed_frontier' });

        expect(await inTx((tx: Tx) => acknowledgeSessionFollowFrontierInTx(tx, {
            ...base,
            expected,
            observed: { ...consumed, turn: { id: 'turn-a', status: 'completed' } },
            consumed: { ...consumed, turn: { id: 'turn-a', status: 'completed' } },
        }))).toEqual({ ok: false, rejection: 'stale_terminal_turn' });
        // A rejected terminal turn must not partially advance the numeric components.
        expect(await readEdge(destination.id, source.id)).toMatchObject({ deliveredTranscriptSeq: 5 });

        expect(await inTx((tx: Tx) => acknowledgeSessionFollowFrontierInTx(tx, {
            ...base,
            expectedPublisherGeneration: generation + 1n,
            expected,
            consumed,
        }))).toEqual({ ok: false, rejection: 'stale_publisher_generation' });

        expect(await inTx((tx: Tx) => acknowledgeSessionFollowFrontierInTx(tx, { ...base, expected, consumed })))
            .toEqual({ ok: true, delivered: consumed });
        expect(await readEdge(destination.id, source.id)).toMatchObject({
            deliveredTranscriptSeq: 9,
            deliveredReadyEventSeq: 4,
            deliveredAgentStateVersion: 2,
            deliveredTurnId: 'turn-b',
            deliveredTurnStatus: 'failed',
        });

        // The replayed acknowledgment carries a now-stale expected tuple and
        // cannot regress the row.
        expect(await inTx((tx: Tx) => acknowledgeSessionFollowFrontierInTx(tx, { ...base, expected, consumed })))
            .toEqual({ ok: false, rejection: 'stale_expected_frontier' });
        expect(await readEdge(destination.id, source.id)).toMatchObject({ deliveredTranscriptSeq: 9 });
    });

    it('performs no acknowledgment while either endpoint is archived and reseeds only when both are restored', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id, SEEDED_SOURCE);
        const destination = await createSession(owner.id);
        await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        });

        for (const sessionId of [destination.id, source.id]) {
            await inTx((tx) => transitionSessionArchiveStateInTx({ tx, sessionId, wasArchived: false, archivedAt: new Date() }));
        }
        await db.session.update({ where: { id: source.id }, data: {
            seq: 30, latestReadyEventSeq: 8, agentStateVersion: 9,
            latestTurnId: 'turn-z', latestTurnStatus: 'cancelled',
        } });

        const archivedGeneration = await loadPublisherGeneration(destination.id);
        expect(await inTx((tx: Tx) => acknowledgeSessionFollowFrontierInTx(tx, {
            principal: runtimePrincipal(owner.id),
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
            expectedPublisherGeneration: archivedGeneration,
            expected: { transcriptSeq: 5, readyEventSeq: 3, agentStateVersion: 2, turn: { id: 'turn-a', status: 'completed' } },
            observed: { transcriptSeq: 30, readyEventSeq: 3, agentStateVersion: 2, turn: { id: 'turn-z', status: 'cancelled' } },
            consumed: { transcriptSeq: 30, readyEventSeq: 3, agentStateVersion: 2, turn: { id: 'turn-z', status: 'cancelled' } },
            acceptance: { kind: 'admitted_input', localInputId: 'irrelevant-while-archived', userMessageSeq: null },
        }))).toEqual({ ok: false, rejection: 'session_archived' });

        // Restoring one endpoint leaves the pair dormant and unseeded.
        await inTx((tx) => transitionSessionArchiveStateInTx({ tx, sessionId: source.id, wasArchived: true, archivedAt: null }));
        expect(await readEdge(destination.id, source.id)).toMatchObject({ deliveredTranscriptSeq: 5 });
        expect(await inTx((tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }))).toEqual([]);

        await inTx((tx) => transitionSessionArchiveStateInTx({ tx, sessionId: destination.id, wasArchived: true, archivedAt: null }));
        expect(await readEdge(destination.id, source.id)).toMatchObject({
            deliveredTranscriptSeq: 30,
            deliveredReadyEventSeq: 8,
            deliveredAgentStateVersion: 9,
            deliveredTurnId: 'turn-z',
            deliveredTurnStatus: 'cancelled',
        });
        expect(await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }))).toEqual([]);
        await db.session.update({ where: { id: source.id }, data: { seq: 31 } });
        expect(await inTx((tx) => observePendingSessionFollowForDestinationInTx(tx, {
            destinationSessionId: destination.id,
            principal: runtimePrincipal(owner.id),
        }))).toMatchObject([{ delivered: { transcriptSeq: 30 }, observed: { transcriptSeq: 31 } }]);
    });

    it('admits runtime observation and ACK only for the verified destination runtime principal', async () => {
        const owner = await createAccount();
        const outsider = await createAccount();
        const source = await createSession(owner.id, SEEDED_SOURCE);
        const destination = await createSession(owner.id);
        await setSessionFollowSource({
            accountId: owner.id,
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
        });

        // A principal that is not the destination runtime observes nothing and
        // cannot acknowledge, even though the edge and frontiers are valid.
        expect(await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            principal: runtimePrincipal(outsider.id),
            destinationSessionId: destination.id,
        }))).toEqual([]);
        await db.session.update({ where: { id: source.id }, data: { seq: 6 } });
        const pending = await inTx((tx: Tx) => observePendingSessionFollowForDestinationInTx(tx, {
            principal: runtimePrincipal(owner.id),
            destinationSessionId: destination.id,
        }));
        expect(pending).toHaveLength(1);
        const generation = await loadPublisherGeneration(destination.id);
        expect(await inTx((tx: Tx) => acknowledgeSessionFollowFrontierInTx(tx, {
            principal: runtimePrincipal(outsider.id),
            destinationSessionId: destination.id,
            sourceSessionId: source.id,
            expectedPublisherGeneration: generation,
            expected: pending[0]!.delivered,
            observed: pending[0]!.observed,
            consumed: pending[0]!.observed,
            acceptance: { kind: 'admitted_input', localInputId: 'irrelevant-for-wrong-principal', userMessageSeq: null },
        }))).toEqual({ ok: false, rejection: 'source_forbidden' });
        expect(await readEdge(destination.id, source.id)).toMatchObject({ deliveredTranscriptSeq: 5 });
    });

    it('removes only the edges whose destination runtime Account actually lost source access, and cascades on Session deletion', async () => {
        const sourceOwner = await createAccount();
        const keeper = await createAccount();
        const loser = await createAccount();
        const source = await createSession(sourceOwner.id);
        const keptDestination = await createSession(keeper.id);
        const lostDestination = await createSession(loser.id);
        await grantAccess(source, keeper.id, 'view');
        await grantAccess(source, loser.id, 'view');
        await grantAccess(keptDestination, sourceOwner.id, 'edit');
        await grantAccess(lostDestination, sourceOwner.id, 'edit');
        await grantAccess(source, sourceOwner.id, 'view');

        for (const destination of [keptDestination, lostDestination]) {
            expect(await setSessionFollowSource({
                accountId: sourceOwner.id,
                destinationSessionId: destination.id,
                sourceSessionId: source.id,
            })).toMatchObject({ ok: true });
        }

        await db.sessionShare.deleteMany({ where: { sessionId: source.id, sharedWithUserId: loser.id } });
        expect(await inTx((tx: Tx) => removeUnsafeSessionFollowEdgesForAccessChangeInTx(tx, {
            sessionId: source.id,
        }))).toBe(1);
        expect(await readEdge(lostDestination.id, source.id)).toBeNull();
        expect(await readEdge(keptDestination.id, source.id)).not.toBeNull();

        await db.session.delete({ where: { id: source.id } });
        expect(await db.sessionFollowEdge.count()).toBe(0);
    });
});
