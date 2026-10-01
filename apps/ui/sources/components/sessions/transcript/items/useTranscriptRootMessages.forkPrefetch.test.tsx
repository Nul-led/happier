import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { createSessionFixture, createSessionMessagesFixture, createTestSessionTranscriptSource, wrapWithSessionTranscriptSource } from '@/dev/testkit';
import { storage, getStorage } from '@/sync/domains/state/storage';
import type { Message } from '@happier-dev/session-core/messages';
import type { SessionTranscriptSource } from '../source/types';

const prefetchForkedTranscriptContextMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

function setChildTranscriptLoaded(isLoaded: boolean): void {
    storage.setState((state) => ({ sessionMessages: { ...state.sessionMessages, child: { ...state.sessionMessages.child!, isLoaded } } }));
}

vi.mock('@/sync/sync', () => ({
    sync: {
        prefetchForkedTranscriptContext: prefetchForkedTranscriptContextMock,
    },
}));

import { useTranscriptRootMessages } from './useTranscriptRootMessages';

const appSource: SessionTranscriptSource = {
    ...createTestSessionTranscriptSource({ sessionId: 'child' }),
    kind: 'app',
    history: {
        loadOlder: null,
        loadTargetWindow: null,
        useState: () => {
            const isLoaded = getStorage()((state) => state.sessionMessages.child?.isLoaded === true);
            return React.useMemo(() => ({ isLoaded, hasOlder: false, isLoadingOlder: false }), [isLoaded]);
        },
    },
};

function Probe(): null {
    useTranscriptRootMessages('child');
    return null;
}

describe('useTranscriptRootMessages fork context prefetch timing', () => {
    beforeEach(() => {
        prefetchForkedTranscriptContextMock.mockClear();
        storage.setState({
            sessions: {
                parent: createSessionFixture({ id: 'parent' }),
                child: createSessionFixture({ id: 'child', metadata: {
                    ...createSessionFixture().metadata!,
                    forkV1: { v: 1, parentSessionId: 'parent', parentCutoffSeqInclusive: 3, createdAtMs: 1, strategy: 'replay' },
                } }),
            },
            sessionMessages: { child: createSessionMessagesFixture(), parent: createSessionMessagesFixture() },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('defers the fork parent-context prefetch until the child transcript load resolves (S-F)', async () => {
        // Live native S-F (2026-07-11): the prefetch fired once at mount, BEFORE the
        // child's initial (empty) /messages page resolved its pagination state, so the
        // sync-side "child fully paged" gate skipped the parent segment and nothing ever
        // retried — the pre-fork parent transcript never rendered. The hook must wait for
        // the child's load to settle and fire when it does.
        let tree: renderer.ReactTestRenderer | undefined;
        await act(async () => {
            tree = renderer.create(wrapWithSessionTranscriptSource(React.createElement(Probe), appSource));
        });

        // Child transcript still loading: firing now would be swallowed by the sync gate.
        expect(prefetchForkedTranscriptContextMock).not.toHaveBeenCalled();

        await act(async () => {
            setChildTranscriptLoaded(true);
        });

        expect(prefetchForkedTranscriptContextMock).toHaveBeenCalledTimes(1);
        expect(prefetchForkedTranscriptContextMock).toHaveBeenCalledWith('child');

        await act(async () => {
            tree?.unmount();
        });
    });

    it('reads a snapshot source without borrowing the viewer store fork context', async () => {
        const message: Message = { kind: 'agent-text', id: 'shared-child', localId: null, createdAt: 1, text: 'Shared', isThinking: false };
        const source = createTestSessionTranscriptSource({ sessionId: 'child', messages: [message] });
        let result: ReturnType<typeof useTranscriptRootMessages> | undefined;
        function SnapshotProbe() {
            result = useTranscriptRootMessages('child');
            return null;
        }
        let tree: renderer.ReactTestRenderer | undefined;
        await act(async () => { tree = renderer.create(wrapWithSessionTranscriptSource(React.createElement(SnapshotProbe), source)); });
        expect(result?.messageIdsOldestFirst).toEqual(['shared-child']);
        expect(result?.messagesById).toEqual({ 'shared-child': message });
        expect(result?.fork).toBeNull();
        expect(prefetchForkedTranscriptContextMock).not.toHaveBeenCalled();
        await act(async () => { tree?.unmount(); });
    });
});
