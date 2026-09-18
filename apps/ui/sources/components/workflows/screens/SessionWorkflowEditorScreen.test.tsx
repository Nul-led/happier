import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeTestInstanceHandler, renderScreen, standardCleanup } from '@/dev/testkit';

const workflowEditorHostSpy = vi.hoisted(() => vi.fn());
/**
 * The canonical route hydration owner's reported state, driven per test. A blank
 * screen cannot say whether the Session is loading, gone, refused or temporarily
 * unreachable, so each of those facts is exercised here.
 */
const hydrationState = vi.hoisted(() => ({
    value: { kind: 'available', sessionId: 'session-1' } as Record<string, unknown>,
}));
const sessionState = vi.hoisted(() => ({
    value: { id: 'session-1', serverId: 'server-1' } as Record<string, unknown> | null,
}));
/** Whether this Session's current context can seed a workflow at all. */
const captureState = vi.hoisted(() => ({ available: true }));
const ensureSessionVisibleSpy = vi.hoisted(() => vi.fn(async () => ({ kind: 'available' })));
const activeAccountScope = vi.hoisted(() => ({
    value: { serverId: 'server-1', accountId: 'account-1' },
}));
// The canonical server feature-decision seam. Automations stays enabled so the
// supported automations-enabled / workflows-unavailable configuration is the one
// under test.
const featureDecisions = vi.hoisted(() => ({
    workflows: { state: 'enabled' } as Record<string, unknown> | null,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: (featureId: string) => (
        featureId === 'workflows' ? featureDecisions.workflows : { state: 'enabled' }
    ),
}));
vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: () => hydrationState.value,
}));
vi.mock('@/sync/domains/state/storage', () => ({
    useSession: () => sessionState.value,
    useActiveServerAccountScope: () => activeAccountScope.value,
}));
vi.mock('@/sync/sync', () => ({
    sync: {
        getSessionEncryptionKeyBase64ForResume: () => null,
        ensureSessionVisibleForMessageRoute: ensureSessionVisibleSpy,
    },
}));
vi.mock('@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters', () => ({
    buildExistingSessionAuthoringDraftFromSessionSnapshot: () => ({}),
}));
vi.mock('@/sync/domains/workflows/capturedSessionWorkflowSeed', () => ({
    buildCapturedSessionWorkflowSeed: ({ draftId }: { draftId: string }) => (captureState.available
        ? {
            draft: { draftId, name: '', inputs: [], defaults: {}, blocks: [] },
            project: { machineId: 'machine-1', directory: '/repo' },
        }
        : null),
}));
vi.mock('./WorkflowEditorHostScreen', () => ({
    WorkflowEditorHostScreen: (props: Record<string, unknown>) => {
        workflowEditorHostSpy(props);
        return React.createElement('WorkflowEditorHostScreen', { testID: 'workflow-editor-host' });
    },
}));

beforeEach(() => {
    workflowEditorHostSpy.mockClear();
    ensureSessionVisibleSpy.mockClear();
    featureDecisions.workflows = { state: 'enabled' };
    hydrationState.value = { kind: 'available', sessionId: 'session-1' };
    sessionState.value = { id: 'session-1', serverId: 'server-1' };
    captureState.available = true;
});

afterEach(async () => {
    await standardCleanup();
});

describe('SessionWorkflowEditorScreen', () => {
    it('mounts the canonical Workflow editor when the Workflows decision is enabled', async () => {
        const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
        const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);

        expect(screen.findByTestId('workflow-editor-host')).not.toBeNull();
        expect(workflowEditorHostSpy).toHaveBeenCalledWith(expect.objectContaining({
            source: expect.objectContaining({ kind: 'capturedSession', sessionId: 'session-1' }),
        }));
    });

    it('keeps the Session-origin Workflow editor unavailable while the decision is disabled', async () => {
        featureDecisions.workflows = { state: 'disabled', blockedBy: 'server' };
        const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
        const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);

        expect(screen.findByTestId('workflows-gate-disabled')).not.toBeNull();
        expect(workflowEditorHostSpy).not.toHaveBeenCalled();
    });

    it('says the Session is opening while the canonical hydration owner is working', async () => {
        hydrationState.value = { kind: 'loading', sessionId: 'session-1', reason: 'cold' };
        sessionState.value = null;
        const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
        const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);

        expect(screen.findByTestId('session-workflow-editor-loading')).not.toBeNull();
        expect(workflowEditorHostSpy).not.toHaveBeenCalled();
    });

    it('reports a Session that is gone without claiming an access problem', async () => {
        hydrationState.value = { kind: 'missing', sessionId: 'session-1', cause: 'not_found' };
        sessionState.value = null;
        const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
        const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);

        expect(screen.findByTestId('session-workflow-editor-missing')).not.toBeNull();
        expect(screen.findByTestId('session-workflow-editor-loading')).toBeNull();
        expect(workflowEditorHostSpy).not.toHaveBeenCalled();
    });

    it('reports a refused Session as inaccessible rather than deleted', async () => {
        hydrationState.value = { kind: 'missing', sessionId: 'session-1', cause: 'forbidden' };
        sessionState.value = null;
        const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
        const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);

        expect(screen.findByTestId('session-workflow-editor-inaccessible')).not.toBeNull();
        expect(screen.findByTestId('session-workflow-editor-missing')).toBeNull();
    });

    it('offers the canonical hydration operation again after a retryable failure', async () => {
        hydrationState.value = { kind: 'retrying', sessionId: 'session-1', cause: 'network' };
        sessionState.value = null;
        const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
        const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);

        const failed = screen.findByTestId('session-workflow-editor-failed');
        expect(failed).not.toBeNull();
        await act(async () => {
            invokeTestInstanceHandler(
                screen.findByTestId('session-workflow-editor-failed-action'),
                'onPress',
            );
        });

        // Retry is the same route-hydration operation the hook performs, asked to
        // run now. It is not a second readiness loop or state machine.
        expect(ensureSessionVisibleSpy).toHaveBeenCalledTimes(1);
        expect(ensureSessionVisibleSpy).toHaveBeenCalledWith(
            'session-1',
            expect.objectContaining({ forceRefresh: true }),
        );
    });

    it('explains a readable Session whose context cannot seed a workflow', async () => {
        captureState.available = false;
        const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
        const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);

        expect(screen.findByTestId('session-workflow-editor-unsupported')).not.toBeNull();
        expect(screen.findByTestId('session-workflow-editor-loading')).toBeNull();
        expect(workflowEditorHostSpy).not.toHaveBeenCalled();
    });

    it('keeps the captured context and the same draft through refresh and Session updates', async () => {
        const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
        const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);
        const capturedSource = workflowEditorHostSpy.mock.calls[0]?.[0]?.source;
        expect(capturedSource).toMatchObject({ kind: 'capturedSession', sessionId: 'session-1' });

        // An ordinary Session snapshot update is a new object. Re-deriving the
        // seed from it would hand the editor a new draft id and discard whatever
        // had been authored.
        sessionState.value = { id: 'session-1', serverId: 'server-1', updatedAt: 2 };
        await screen.update(<SessionWorkflowEditorScreen sessionId="session-1" />);
        expect(workflowEditorHostSpy.mock.lastCall?.[0]?.source.draft).toBe(capturedSource.draft);

        // A refresh or a transient failure must not replace the editor with a
        // spinner: the last-known-good context is still exactly what is authored.
        hydrationState.value = { kind: 'retrying', sessionId: 'session-1', cause: 'network' };
        await screen.update(<SessionWorkflowEditorScreen sessionId="session-1" />);
        expect(screen.findByTestId('workflow-editor-host')).not.toBeNull();
        expect(screen.findByTestId('session-workflow-editor-failed')).toBeNull();
        expect(workflowEditorHostSpy.mock.lastCall?.[0]?.source.draft).toBe(capturedSource.draft);
    });

    it.each([
        ['unknown', { state: 'unknown' }],
        ['unresolved', null],
    ] as const)(
        'never authors a Session-origin Workflow on an %s decision',
        async (_label, decision) => {
            featureDecisions.workflows = decision as Record<string, unknown> | null;
            const { SessionWorkflowEditorScreen } = await import('./SessionWorkflowEditorScreen');
            const screen = await renderScreen(<SessionWorkflowEditorScreen sessionId="session-1" />);

            expect(screen.findByTestId('workflows-gate-loading')).not.toBeNull();
            expect(workflowEditorHostSpy).not.toHaveBeenCalled();
        },
    );
});
