import { describe, expect, it, vi } from 'vitest';

import { createToolCallMessageFixture } from '@/dev/testkit/fixtures/transcriptFixtures';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { storage } from '@/sync/domains/state/storageStore';
import type { Message } from "@happier-dev/session-core/messages";
import { buildMessageRouteId, resolveSessionMessageRouteId } from '@happier-dev/session-core/messages';
import { debugMessages } from '@/dev/messagesDemoData';
import { useDemoMessages } from './useDemoMessages';

// Direct Expo random imports in the shared UI graph use the real Node OS adapter.
vi.mock('expo-crypto', async () => ({
    ...await import('@/platform/cryptoRandom.node'),
    ...await import('@/platform/randomUUID.node'),
}));

describe('useDemoMessages', () => {
    it('resolves the real demo tool routes from their materialized dataset', async () => {
        const hook = await renderHook(() => useDemoMessages(debugMessages));
        const source = hook.getCurrent();
        const routeData = await renderHook(() => ({ messagesById: source.useMessagesById(), reducerState: source.useReducerState() }));
        const tools = debugMessages.flatMap((message) => message.kind === 'tool-call'
            ? [message, ...message.children.filter((child) => child.kind === 'tool-call')]
            : []);
        expect(tools.length).toBeGreaterThan(0);
        for (const message of tools) {
            expect(resolveSessionMessageRouteId({ routeMessageId: buildMessageRouteId(message), ...routeData.getCurrent() })).toBe(message.id);
        }
        await routeData.unmount();
        await hook.unmount();
    });
    it('renders a local dataset without creating or deleting global session rows', async () => {
        const messages: Message[] = [{
            kind: 'user-text', id: 'demo-user', localId: null, createdAt: 1,
            text: 'A local demo message',
        }];
        const before = storage.getState();
        const hook = await renderHook((rows: Message[]) => useDemoMessages(rows), { initialProps: messages });

        expect(storage.getState()).toBe(before);
        await hook.rerender([...messages, {
            kind: 'user-text', id: 'demo-updated', localId: null, createdAt: 2,
            text: 'An updated local demo message',
        }]);
        expect(storage.getState()).toBe(before);
        await hook.unmount();
        expect(storage.getState()).toBe(before);
    });

    it('preserves rich materialized tool rows and their children in its local source', async () => {
        const child: Message = {
            kind: 'agent-text', id: 'demo-child', localId: null, createdAt: 2,
            text: 'A sidechain response', isThinking: false,
        };
        const tool = createToolCallMessageFixture({ id: 'demo-tool', children: [child] });
        const hook = await renderHook<ReturnType<typeof useDemoMessages>, Message[]>((messages) => useDemoMessages(messages), { initialProps: [tool] });
        const source = hook.getCurrent();
        const rows = await renderHook(() => source.useMessagesById());

        expect(source.kind).toBe('readOnly');
        expect(rows.getCurrent()[tool.id]).toBe(tool);
        expect(rows.getCurrent()[child.id]).toBe(child);
        expect(rows.getCurrent()[tool.id]).toMatchObject({ children: [child] });
        expect(source.actions).toBeNull();

        const older: Message = { kind: 'user-text', id: 'older', localId: null, createdAt: 0, text: 'Older demo row' };
        await hook.rerender([tool, older]);
        expect(hook.getCurrent()).toBe(source);
        const ids = await renderHook(() => source.useMessageIdsOldestFirst());
        expect(ids.getCurrent()).toEqual([older.id, tool.id]);
        expect(rows.getCurrent()[tool.id]).toBe(tool);
        expect(rows.getCurrent()[child.id]).toBe(child);
    });
});
