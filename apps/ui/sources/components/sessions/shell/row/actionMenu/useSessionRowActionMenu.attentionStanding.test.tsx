/**
 * The row menu chain end to end: a target built by the production
 * `createSessionActionTarget`, rendered through the real menu builder, then
 * dispatched through the real `handleMoreMenuSelect` switch into the real
 * `executeSessionAction`. A hand-built target literal plus a hand-built menu
 * item would pass even when no production call site supplies the standing
 * inputs and the dispatch switch drops the id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import {
    SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID,
    SESSION_ACTION_SET_ATTENTION_STANDING_ID,
} from '@/components/sessions/actions/sessionActionIds';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { createSessionAccessFixture } from '@/dev/testkit/fixtures/sessionFixtures';

import { useSessionRowActionMenu } from './useSessionRowActionMenu';

const setAttentionStandingWrite = vi.fn(async () => ({ success: true as const }));
const clearAttentionReminderWrite = vi.fn(async () => ({ success: true as const }));

vi.mock('@/sync/ops/sessionOrganization', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    sessionSetAttentionStandingWithServerScope: (...args: readonly unknown[]) => setAttentionStandingWrite(...(args as [])),
    sessionClearAttentionReminderWithServerScope: (...args: readonly unknown[]) => clearAttentionReminderWrite(...(args as [])),
}));

function makeSession(): SessionListRenderableSession {
    return {
        id: 'session_1',
        active: false,
        archivedAt: null,
        owner: 'user_1',
        access: createSessionAccessFixture(),
        accessLevel: undefined,
        seq: 4,
        lastViewedSessionSeq: 4,
        latestTurnStatus: 'completed',
        createdAt: 1,
        updatedAt: 1,
        activeAt: 1,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: null,
        thinking: false,
        thinkingAt: 0,
        presence: 1,
    };
}

function renderRowMenu(params: Readonly<{
    attentionStandingEnabled: boolean;
    attentionStanding: boolean;
    reminder?: Readonly<{ state: 'scheduled' | 'due'; remindAt: number }>;
}>) {
    const target = createSessionActionTarget({
        session: makeSession(),
        serverId: 'server_1',
        currentUserId: 'user_1',
        isConnected: false,
        attentionStandingEnabled: params.attentionStandingEnabled,
        attentionStanding: params.attentionStanding,
    });
    return renderHook(() => useSessionRowActionMenu({
        target,
        sessionName: 'Session one',
        hideInactiveSessions: false,
        iconColor: '#000000',
        activeTags: [],
        knownTags: [],
        tagsEnabled: false,
        isNativeMobile: false,
        setContextMenuOpen: () => undefined,
        openTagsMenuFromContext: () => undefined,
        reminder: params.reminder,
    }));
}

afterEach(() => {
    standardCleanup();
    setAttentionStandingWrite.mockClear();
    clearAttentionReminderWrite.mockClear();
});

describe('session row action menu attention standing', () => {
    it('renders Keep in Needs attention and writes standing when it is pressed', async () => {
        const menu = await renderRowMenu({ attentionStandingEnabled: true, attentionStanding: false });

        expect(menu.getCurrent().moreMenuItems.map((item) => item.id))
            .toContain(SESSION_ACTION_SET_ATTENTION_STANDING_ID);

        await menu.getCurrent().handleMoreMenuSelect(SESSION_ACTION_SET_ATTENTION_STANDING_ID);

        expect(setAttentionStandingWrite).toHaveBeenCalledWith('session_1', true, { serverId: 'server_1' });
    });

    it('renders Remove from Needs attention for a standing session and clears it', async () => {
        const menu = await renderRowMenu({ attentionStandingEnabled: true, attentionStanding: true });

        expect(menu.getCurrent().moreMenuItems.map((item) => item.id))
            .toContain(SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID);

        await menu.getCurrent().handleMoreMenuSelect(SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID);

        expect(setAttentionStandingWrite).toHaveBeenCalledWith('session_1', false, { serverId: 'server_1' });
    });

    it('renders neither direction while the attention band is off', async () => {
        const menu = await renderRowMenu({ attentionStandingEnabled: false, attentionStanding: false });
        const ids = menu.getCurrent().moreMenuItems.map((item) => item.id);

        expect(ids).not.toContain(SESSION_ACTION_SET_ATTENTION_STANDING_ID);
        expect(ids).not.toContain(SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID);
    });

    it('clears the current reminder through the canonical standing mutation', async () => {
        const menu = await renderRowMenu({
            attentionStandingEnabled: true,
            attentionStanding: false,
            reminder: { state: 'scheduled', remindAt: Date.now() + 60_000 },
        });
        const reminderItem = menu.getCurrent().moreMenuItems.find((item) => item.id === 'attention-reminder');
        expect(reminderItem?.submenu?.items.at(-1)?.id).toBe('attention-reminder:remove');

        await menu.getCurrent().handleMoreMenuSelect('attention-reminder:remove');

        expect(clearAttentionReminderWrite).toHaveBeenCalledWith('session_1', { serverId: 'server_1' });
    });
});
