import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultActionExecutor } from './defaultActionExecutor';

/**
 * The Session Board Action gate reads its capabilities from the exact Session row the
 * store holds. That row carries the already-normalized `access` projection, so a reader
 * that re-normalizes a raw `effectiveAccess` field finds nothing and refuses every
 * Board mutation. This suite pins the gate to the field the store actually publishes.
 */

const board = vi.hoisted(() => ({
    adapter: vi.fn(),
    capabilities: null as unknown,
}));

const storeSession = {
    id: 'session-one',
    serverId: 'home-a',
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    active: true,
    activeAt: 1,
    encryptionMode: 'plain' as const,
    access: {
        role: 'owner' as const,
        level: 'owner' as const,
        capabilities: {
            readTranscript: true,
            editSessionRecords: true,
            sendMessages: true,
            manageAccess: true,
            approvePermissions: true,
        },
    },
};

vi.mock('./actionAccountContext', () => ({
    captureActionAccountContext: vi.fn(async () => ({
        serverId: 'home-a',
        serverIdentityId: 'stable-home-a',
        accountId: 'account-a',
        credentials: { token: 'unused' },
        accountMode: 'plain' as const,
        request: vi.fn(),
        assertCurrent: () => {},
        dispose: () => {},
        readSettings: async () => ({ actionsSettingsV1: { v: 1, actions: {} } }),
        readLiveSettings: () => null,
        runPrepared: async <T>(run: () => Promise<T>) => await run(),
        fetchArtifact: vi.fn(async () => null),
        createArtifact: vi.fn(async () => 'artifact-1'),
        updateArtifact: vi.fn(async () => {}),
    })),
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        withSessionSystemRecordRuntime: vi.fn(async (_address: unknown, operation: (runtime: unknown) => Promise<unknown>) => ({
            status: 'ok' as const,
            value: await operation({
                scope: { serverId: 'home-a', accountId: 'account-a' },
                request: vi.fn(),
                repository: {},
                session: storeSession,
                contentContext: { mode: 'plain' as const },
                readSession: () => storeSession,
                readContentContext: () => ({ mode: 'plain' as const }),
                isCurrent: () => true,
            }),
        })),
    },
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: vi.fn(async () => ({})),
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    resolveRuntimeFeatureDecisionFromSnapshot: vi.fn(() => ({ state: 'enabled' })),
}));

vi.mock('@/sync/api/session/sessionBoardActions', () => ({
    createSessionBoardActionAdapter: vi.fn((params: { capabilities: unknown }) => {
        board.capabilities = params.capabilities;
        return board.adapter;
    }),
}));

const intent = {
    sessionId: 'session-one',
    itemId: 'release-checklist',
    expectedItemRevision: null,
    item: {
        v: 1,
        title: 'Release checklist',
        frame: 'card',
        height: { mode: 'auto', fallback: 'regular' },
        source: {
            kind: 'declarative',
            document: { version: 1, root: { kind: 'markdown', text: 'Ready' } },
        },
    },
    placement: { tabId: 'overview', tabTitle: 'Overview' },
} as const;

describe('Session Board Action access gate', () => {
    beforeEach(() => {
        board.capabilities = null;
        board.adapter.mockReset();
        board.adapter.mockResolvedValue({ ok: true, result: { itemRevision: 2 } });
    });

    it('admits an owner whose store row carries the normalized access projection', async () => {
        const result = await createDefaultActionExecutor().execute(
            'session.board.item.upsert',
            intent,
            { serverId: 'home-a', surface: 'ui', authority: 'present_user' },
        );

        // The gate admitted the owner and handed the Board adapter exactly the two
        // capabilities it consumes. (The adapter's own payload contract is pinned by
        // `packages/protocol/src/sessions/board/actions.test.ts`, not here.)
        expect(board.adapter).toHaveBeenCalledTimes(1);
        expect(board.capabilities).toEqual({ readTranscript: true, editSessionRecords: true });
        expect(result).not.toMatchObject({ errorCode: 'session_board_forbidden' });
    });

    it('still refuses a row with no access projection at all', async () => {
        const { sync } = await import('@/sync/sync');
        vi.mocked(sync.withSessionSystemRecordRuntime).mockImplementationOnce(
            async (_address: unknown, operation: (runtime: any) => Promise<unknown>) => ({
                status: 'ok' as const,
                value: await operation({
                    scope: { serverId: 'home-a', accountId: 'account-a' },
                    request: vi.fn(),
                    repository: {},
                    session: { ...storeSession, access: undefined },
                    contentContext: { mode: 'plain' as const },
                    readSession: () => storeSession,
                    readContentContext: () => ({ mode: 'plain' as const }),
                    isCurrent: () => true,
                }),
            }) as any,
        );

        await expect(createDefaultActionExecutor().execute(
            'session.board.item.upsert',
            intent,
            { serverId: 'home-a', surface: 'ui', authority: 'present_user' },
        )).resolves.toMatchObject({ ok: false, errorCode: 'session_board_forbidden' });
        expect(board.adapter).not.toHaveBeenCalled();
    });
});
