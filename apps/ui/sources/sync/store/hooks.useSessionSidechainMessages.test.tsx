import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';

import { useSessionSidechainMessages } from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';
import { createReducer } from "@happier-dev/session-core/reducer";

afterEach(() => {
    standardCleanup();
});

function sidechainRow(input: Readonly<{ id: string; role: 'user' | 'agent'; text: string; createdAt: number }>) {
    return {
        id: input.id,
        realID: input.id,
        seq: input.createdAt,
        localId: null,
        createdAt: input.createdAt,
        role: input.role,
        text: input.text,
        event: null,
        tool: null,
    } as any;
}

function installSession(reducerState: any, messagesVersion: number) {
    storage.setState((state) => ({
        ...state,
        sessionMessages: {
            ...state.sessionMessages,
            's-1': {
                messageIdsOldestFirst: [],
                messagesById: {},
                messagesMap: {},
                reducerState,
                latestThinkingMessageId: null,
                latestThinkingMessageActivityAtMs: null,
                messagesVersion,
                reducerVersion: messagesVersion,
                isLoaded: true,
            } as any,
        },
    }));
}

describe('useSessionSidechainMessages', () => {
    it('projects the committed rows of one sidechain and follows in-place reducer growth', async () => {
        const previousState = storage.getState();
        try {
            const reducerState = createReducer();
            reducerState.sidechains.set('sidechain-a', [
                sidechainRow({ id: 'row-user', role: 'user', text: 'Start the run', createdAt: 1 }),
                sidechainRow({ id: 'row-agent', role: 'agent', text: 'Working on it', createdAt: 2 }),
            ]);
            reducerState.sidechains.set('sidechain-b', [
                sidechainRow({ id: 'other-row', role: 'agent', text: 'Another run', createdAt: 1 }),
            ]);
            installSession(reducerState, 1);

            const hook = await renderHook(() => useSessionSidechainMessages('s-1', 'sidechain-a'), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent().map((message) => message.id)).toEqual(['row-user', 'row-agent']);
            expect(hook.getCurrent().map((message) => message.kind)).toEqual(['user-text', 'agent-text']);

            await act(async () => {
                reducerState.sidechains.get('sidechain-a')!.push(
                    sidechainRow({ id: 'row-agent-2', role: 'agent', text: 'Done', createdAt: 3 }),
                );
                installSession(reducerState, 2);
                await flushHookEffects({ cycles: 1, turns: 4 });
            });

            expect(hook.getCurrent().map((message) => message.id)).toEqual(['row-user', 'row-agent', 'row-agent-2']);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('returns nothing for an unknown sidechain or an absent id', async () => {
        const previousState = storage.getState();
        try {
            const reducerState = createReducer();
            reducerState.sidechains.set('sidechain-a', [
                sidechainRow({ id: 'row-user', role: 'user', text: 'Start the run', createdAt: 1 }),
            ]);
            installSession(reducerState, 1);

            const unknown = await renderHook(() => useSessionSidechainMessages('s-1', 'sidechain-missing'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            expect(unknown.getCurrent()).toEqual([]);
            await unknown.unmount();

            const absent = await renderHook(() => useSessionSidechainMessages('s-1', null), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            expect(absent.getCurrent()).toEqual([]);
            await absent.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
