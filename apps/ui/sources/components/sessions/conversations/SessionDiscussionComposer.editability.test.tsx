import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { SessionDiscussionComposer, type SessionDiscussionComposerValue } from './SessionDiscussionComposer';

const listMentionCandidates = vi.hoisted(() => vi.fn(async () => ({
    candidates: [] as Array<{
        accountId: string;
        profile: { firstName: string | null; lastName: string | null; username: string | null; avatarUrl: string | null };
        accessHint: 'owner' | 'admin' | 'edit' | 'view';
    }>,
    nextCursor: null as string | null,
})));

vi.mock('@/sync/api/session/sessionDiscussionActions', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/api/session/sessionDiscussionActions')>()),
    listSessionDiscussionMentionCandidates: listMentionCandidates,
}));

function ComposerHarness(): React.ReactElement {
    const [value, setValue] = React.useState<SessionDiscussionComposerValue>({ text: '', mentions: [] });
    return (
        <SessionDiscussionComposer
            scope={{ serverId: 'server-b', accountId: 'viewer-b' }}
            address={{ serverId: 'server-b', sessionId: 'session-shared-id' }}
            availability="full_collaboration"
            value={value}
            onChange={setValue}
            disabled={false}
            onSend={() => undefined}
        />
    );
}

describe('SessionDiscussionComposer empty-draft editability', () => {
    beforeEach(() => {
        listMentionCandidates.mockReset();
        listMentionCandidates.mockResolvedValue({ candidates: [], nextCursor: null });
    });

    it.each(['new', 'existing'])('keeps an empty %s Discussion editor editable while enabling only Send after typing', async () => {
        const screen = await renderScreen(<ComposerHarness />);

        expect(screen.findByTestId('session-discussion-composer')?.props.editable).toBe(true);
        expect(screen.findByTestId('session-discussion-composer')?.props.accessibilityLabel).toBe('Write a message…');
        expect(screen.findByTestId('session-discussion-send')?.props.disabled).toBe(true);

        await act(async () => {
            screen.changeTextByTestId('session-discussion-composer', 'Ready to review');
        });

        expect(screen.findByTestId('session-discussion-composer')?.props.editable).toBe(true);
        expect(screen.findByTestId('session-discussion-send')?.props.disabled).toBe(false);
    });

    it('uses the canonical caret-anchored command menu for accessible mention candidates', async () => {
        listMentionCandidates.mockResolvedValueOnce({
            candidates: [{
                accountId: 'account-alice',
                profile: { firstName: 'Alice', lastName: 'Ng', username: 'alice', avatarUrl: 'https://example.test/alice.png' },
                accessHint: 'view',
            }],
            nextCursor: null,
        });
        const screen = await renderScreen(<ComposerHarness />);

        await act(async () => {
            screen.changeTextByTestId('session-discussion-composer', '@a');
        });
        await act(async () => undefined);

        expect(screen.findByTestId('session-discussion-mention-command-menu:surface')).not.toBeNull();
        expect(screen.findByTestId('session-discussion-composer')?.props.accessibilityRole).toBe('combobox');
        expect(screen.findByTestId('session-discussion-composer')?.props.accessibilityState).toEqual({ expanded: true });
        expect(screen.findByTestId('session-discussion-mention-account-alice-avatar')).not.toBeNull();
        expect(screen.findByTestId('session-discussion-mention-account-alice-context')?.props.children).toContain('View only');
    });

    it('keeps a dismissed mention trigger closed until the composer trigger changes', async () => {
        listMentionCandidates.mockResolvedValue({
            candidates: [{
                accountId: 'account-alice',
                profile: { firstName: 'Alice', lastName: 'Ng', username: 'alice', avatarUrl: null },
                accessHint: 'view',
            }],
            nextCursor: null,
        });
        const screen = await renderScreen(<ComposerHarness />);

        await act(async () => {
            screen.changeTextByTestId('session-discussion-composer', '@a');
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-discussion-mention-command-menu:surface')).not.toBeNull());

        await act(async () => {
            const preventDefault = vi.fn();
            screen.findByTestId('session-discussion-composer')?.props.onKeyPress({
                preventDefault,
                nativeEvent: {
                    key: 'Escape',
                    shiftKey: false,
                    isComposing: false,
                },
            });
            expect(preventDefault).toHaveBeenCalledOnce();
        });

        expect(screen.findByTestId('session-discussion-mention-command-menu:surface')).toBeNull();
        expect(screen.findByTestId('session-discussion-composer')?.props.accessibilityState).toEqual({ expanded: false });

        await act(async () => {
            screen.changeTextByTestId('session-discussion-composer', '@al');
        });
        await vi.waitFor(() => expect(screen.findByTestId('session-discussion-mention-command-menu:surface')).not.toBeNull());
    });
});
