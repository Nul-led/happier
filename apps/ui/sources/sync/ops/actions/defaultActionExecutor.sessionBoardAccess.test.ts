import {
    createPlainSessionOwnerMetadataEnvelopeV1,
    projectLegacySessionAccessCapabilitiesV1,
    projectSessionSharedMetadataV1,
    SessionOwnerMetadataV1Schema,
    tryWriteServerEnabledBitInPlace,
} from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Imported from their owning testkit modules, never the `@/dev/testkit` barrel:
// the harness installs its network boundaries with `vi.doMock`, which only
// reaches modules imported afterwards (see `installHomeGovernanceBoundaries`).
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { createUiApprovalRequest, decideApprovalAsInbox } from '@/dev/testkit/harness/approvalInbox';
import {
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
} from '@/dev/testkit/harness/homeGovernanceHarness';

/**
 * The Session Board Action gate reads its capabilities from the exact Session row the
 * store holds, and a Board mutation — live or replayed from the Inbox — reaches its
 * Home through the one Session system-record runtime.
 *
 * Only genuine boundaries are replaced: the Home's network answers and the device
 * credential store (the Home governance harness). The captured Account context, the
 * exact Home's `sessions.board` decision, the Session hydration that produces the
 * store row and its normalized `access` projection, the system-record runtime, the
 * Board adapter and the approval Artifact lifecycle all run for real.
 */

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const ACCOUNT_ID = 'account-a';
const SESSION_ID = 'session-one';
const BOARD_PATH = `/v2/sessions/${SESSION_ID}/board`;
const REVISION = 'ssr1.AAAACHN5c3JlY18xAAAAAQ';

/**
 * A Plain Session row exactly as the Home's current detail route serves it
 * (`accessProjectionVersion=1`): the owner's own row, or a direct view-only share.
 */
function homeSessionRow(viewer: 'owner' | 'view_recipient') {
    const owner = viewer === 'owner';
    return {
        session: {
            id: SESSION_ID, createdAt: 1, updatedAt: 2, seq: 3, active: true, activeAt: 2,
            encryptionMode: 'plain', dataEncryptionKey: null,
            metadataLayoutVersion: 1, metadataVersion: 4,
            metadata: JSON.stringify(projectSessionSharedMetadataV1({
                metadata: { path: '/work/project', machineId: 'machine-1', summary: { text: 'Release', updatedAt: 1 } },
                agentState: null,
            })),
            ...(owner ? {
                ownerMetadata: createPlainSessionOwnerMetadataEnvelopeV1(SessionOwnerMetadataV1Schema.parse({
                    v: 1,
                    workspace: { path: '/work/project', machineId: 'machine-1' },
                })),
            } : {}),
            agentStateVersion: 5, agentState: null,
            share: owner ? null : { accessLevel: 'view', canApprovePermissions: false },
            effectiveAccess: owner
                ? {
                    v: 1, level: 'owner', sources: [{ kind: 'owner' }],
                    capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'owner', canApprovePermissions: true }),
                }
                : {
                    v: 1, level: 'view', sources: [{ kind: 'direct', shareId: 'share-1' }],
                    capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'view' }),
                },
            responsibleAccountId: null, responsibleAccount: null,
        },
    };
}

const LAYOUT_READ_PATH = `/v2/sessions/${SESSION_ID}/system-records/record?owner=host&namespace=surface&kind=layout.v1&localId=layout`;

/** The Board layout record exactly as the Home stores it for a Plain Session. */
const storedLayout = {
    record: {
        id: 'layout-row',
        address: { owner: 'host', namespace: 'surface', kind: 'layout.v1', localId: 'layout' },
        content: { t: 'plain', v: { v: 1, tabs: [{ id: 'overview', title: 'Overview', items: [] }] } },
        revision: REVISION,
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
    },
};

/**
 * One Home holding `account-a` that publishes the Session Board gate and serves
 * the Session, its empty Board and the Board write route.
 */
async function addBoardHome(options: Readonly<{
    serverUrl?: string;
    serverIdentityId?: string;
    viewer?: Parameters<typeof homeSessionRow>[0];
}> = {}): Promise<string> {
    const serverId = await harness.addHome({
        name: 'Home A',
        serverUrl: options.serverUrl ?? 'https://board-home.example',
        accountId: ACCOUNT_ID,
        ...(options.serverIdentityId ? { serverIdentityId: options.serverIdentityId } : {}),
    });
    const features = createRootLayoutFeaturesResponse();
    if (!tryWriteServerEnabledBitInPlace(features, 'sessions.board', true)) {
        throw new Error('The sessions.board feature bit could not be written by its own writer');
    }
    harness.answer(serverId, '/v1/features', { body: features });
    harness.answer(serverId, '/v1/features/authenticated', { body: features });
    const { primeServerFeaturesSnapshot } = await import('@/sync/api/capabilities/serverFeaturesClient');
    primeServerFeaturesSnapshot({ serverId, snapshot: { status: 'ready', features } });
    harness.answer(serverId, '/v1/auth/ping', { body: { success: true } });
    // The owner's row is admitted against its Plain Account's current encryption facts.
    harness.answer(serverId, '/v1/account/encryption/currentness', {
        body: { mode: 'plain', version: 0, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 0 },
    });
    harness.answer(serverId, `/v2/sessions/${SESSION_ID}?accessProjectionVersion=1`, { body: homeSessionRow(options.viewer ?? 'owner') });
    harness.answer(serverId, LAYOUT_READ_PATH, { body: storedLayout });
    harness.answer(serverId, `PUT ${BOARD_PATH}`, {
        body: { operation: 'update_layout', outcome: 'updated', layoutRevision: REVISION },
    });
    return serverId;
}

function boardWrites() {
    return harness.requestsFor(BOARD_PATH);
}

/** What was asked of the Home, for a failure message. */
function observed(result: unknown): string {
    return JSON.stringify({ result, requests: harness.requests.map((request) => request.path) });
}

/** Renaming a Board view: a write against the Board's current layout revision. */
const intent = {
    sessionId: SESSION_ID,
    expectedLayoutRevision: REVISION,
    operation: { op: 'tab.rename', tabId: 'overview', title: 'Release' },
} as const;

describe('Session Board Action access gate', () => {
    beforeEach(async () => {
        await harness.reset();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('admits an owner whose store row carries the normalized access projection', async () => {
        const serverId = await addBoardHome();
        const { createDefaultActionExecutor } = await import('./defaultActionExecutor');

        const result = await createDefaultActionExecutor().execute(
            'session.board.layout.update',
            intent,
            { serverId, surface: 'ui', authority: 'present_user' },
        );

        expect(result, observed(result)).toMatchObject({ ok: true, result: { result: { operation: 'update_layout', outcome: 'updated' } } });
        expect(boardWrites()).toHaveLength(1);
    });

    it('refuses a view-only recipient before any Board write', async () => {
        // Its own Home: a Session row the store already holds for another case's
        // Home must not stand in for this Home's answer.
        const serverId = await addBoardHome({ serverUrl: 'https://recipient-board-home.example', viewer: 'view_recipient' });
        const { createDefaultActionExecutor } = await import('./defaultActionExecutor');

        const result = await createDefaultActionExecutor().execute(
            'session.board.layout.update',
            intent,
            { serverId, surface: 'ui', authority: 'present_user' },
        );
        expect(result, observed(result)).toMatchObject({ ok: false, errorCode: 'session_board_forbidden' });
        expect(boardWrites()).toHaveLength(0);
    });

    it('replays an approved Board mutation from the Inbox on a Home that publishes a portable identity', async () => {
        // The Board surface and the Inbox address the Home by its device-local profile
        // id; the captured Account scope names it by its published identity. Both name
        // the same Home, so the replay must reach it exactly once.
        const serverId = await addBoardHome({
            serverUrl: 'https://identity-board-home.example',
            serverIdentityId: 'srv_board_home',
        });
        await harness.requireUiApproval(serverId, 'session.board.layout.update');

        const artifactId = await createUiApprovalRequest({
            serverId,
            actionId: 'session.board.layout.update',
            actionInput: intent,
            actionRequestId: 'board-rename-request-1',
        });
        expect(boardWrites()).toHaveLength(0);

        const decided = await decideApprovalAsInbox(serverId, artifactId, 'approve');

        const stored = JSON.parse(harness.artifacts(serverId).readPlainBody(artifactId) ?? 'null');
        expect(decided, `${JSON.stringify(stored?.execution)} ${observed(decided)}`).toMatchObject({ ok: true, result: { status: 'executed' } });
        expect(stored).toMatchObject({ status: 'executed', execution: { ok: true } });
        expect(boardWrites()).toHaveLength(1);
    });

    it('approves a deferred Board item creation, whose required item revision is null by contract', async () => {
        // `expectedItemRevision: null` is how the Action requests creation. It is present
        // context the schema admits, not missing context, so the Inbox can approve it.
        const serverId = await addBoardHome({ serverUrl: 'https://create-board-home.example' });
        // The item does not exist yet: the Home's strict record read answers an empty record.
        harness.answer(serverId, `/v2/sessions/${SESSION_ID}/system-records/record?owner=host&namespace=surface&kind=item.v1&localId=release-checklist`, {
            body: { record: null },
        });
        harness.answer(serverId, `PUT ${BOARD_PATH}`, {
            body: {
                operation: 'upsert_item',
                itemId: 'release-checklist',
                outcome: 'created',
                itemRevision: REVISION,
                layoutRevision: REVISION,
            },
        });
        await harness.requireUiApproval(serverId, 'session.board.item.upsert');

        const artifactId = await createUiApprovalRequest({
            serverId,
            actionId: 'session.board.item.upsert',
            actionInput: {
                sessionId: SESSION_ID,
                itemId: 'release-checklist',
                expectedItemRevision: null,
                item: {
                    v: 1,
                    title: 'Release checklist',
                    frame: 'card',
                    height: { mode: 'auto', fallback: 'regular' },
                    source: { kind: 'declarative', document: { version: 1, root: { kind: 'markdown', text: '# Release checklist' } } },
                },
                placement: { tabId: 'overview', width: 'wide' },
            },
            actionRequestId: 'board-create-request-1',
        });
        expect(boardWrites()).toHaveLength(0);

        const decided = await decideApprovalAsInbox(serverId, artifactId, 'approve');

        const stored = JSON.parse(harness.artifacts(serverId).readPlainBody(artifactId) ?? 'null');
        expect(decided, `${JSON.stringify(stored?.execution)} ${observed(decided)}`).toMatchObject({ ok: true, result: { status: 'executed' } });
        expect(stored).toMatchObject({ status: 'executed', execution: { ok: true } });
        expect(boardWrites()).toHaveLength(1);
        expect(boardWrites()[0]?.input).toMatchObject({ operation: 'upsert_item', expectedItemRevision: null });
    });
});
