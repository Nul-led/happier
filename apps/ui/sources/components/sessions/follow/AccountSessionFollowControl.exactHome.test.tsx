import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const editorSpy = vi.hoisted(() => vi.fn());

// Server capability probing and the Follow HTTP surface are the genuine boundaries
// here; the metadata read this test is about stays real.
vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => true,
}));
vi.mock('@/sync/api/session/sessionFollowApi', () => ({
    sessionFollowGet: vi.fn(async () => ({ ok: true as const, value: null })),
    sessionFollowSet: vi.fn(async () => ({ ok: true as const, value: null })),
    sessionFollowRemove: vi.fn(async () => ({ ok: true as const, value: null })),
}));
vi.mock('./AccountSessionFollowEditor', () => ({
    AccountSessionFollowEditor: (props: unknown) => {
        editorSpy(props);
        return null;
    },
}));

import { getStorage } from '@/sync/domains/state/storage';
import { AccountSessionFollowControl } from './AccountSessionFollowControl';

const SESSION_ID = 's_shared';
const HOME_A = 'home-a';
const HOME_B = 'home-b';

const EXTERNAL_ATTACHED_ONLY_METADATA = {
    name: 'Linked external session',
    externalSessionV1: {
        v: 1,
        agentId: 'claude',
        machineId: 'machine-1',
        remoteSessionId: 'remote-1',
        source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'proj-1' },
    },
} as const;

const initialState = getStorage().getState();

beforeEach(() => {
    editorSpy.mockClear();
    getStorage().setState(initialState, true);
});

afterEach(async () => {
    await standardCleanup();
});

describe('AccountSessionFollowControl background-sync warning', () => {
    it('reads the linked-external fact from the Home it was opened for', async () => {
        getStorage().setState({
            // Home A's hydrated entity for the same Session id is a linked external session.
            sessions: {
                [SESSION_ID]: {
                    id: SESSION_ID,
                    serverId: HOME_A,
                    metadata: EXTERNAL_ATTACHED_ONLY_METADATA,
                },
            },
            sessionListRowsByServerId: {
                [HOME_B]: {
                    [SESSION_ID]: {
                        id: SESSION_ID,
                        serverId: HOME_B,
                        metadata: { name: 'Ordinary session on Home B' },
                    },
                },
            },
        } as never);

        await renderScreen(
            <AccountSessionFollowControl address={{ serverId: HOME_B, sessionId: SESSION_ID }} />,
        );

        expect(editorSpy).toHaveBeenCalled();
        const props = editorSpy.mock.calls.at(-1)?.[0] as { externalBackgroundSyncOff?: boolean };
        expect(props.externalBackgroundSyncOff).toBe(false);
    });

    it('still warns on the Home whose own row is the attached-only external session', async () => {
        getStorage().setState({
            sessions: {
                [SESSION_ID]: {
                    id: SESSION_ID,
                    serverId: HOME_A,
                    metadata: EXTERNAL_ATTACHED_ONLY_METADATA,
                },
            },
            sessionListRowsByServerId: {
                [HOME_A]: {
                    [SESSION_ID]: {
                        id: SESSION_ID,
                        serverId: HOME_A,
                        metadata: EXTERNAL_ATTACHED_ONLY_METADATA,
                    },
                },
            },
        } as never);

        await renderScreen(
            <AccountSessionFollowControl address={{ serverId: HOME_A, sessionId: SESSION_ID }} />,
        );

        const props = editorSpy.mock.calls.at(-1)?.[0] as { externalBackgroundSyncOff?: boolean };
        expect(props.externalBackgroundSyncOff).toBe(true);
    });
});
