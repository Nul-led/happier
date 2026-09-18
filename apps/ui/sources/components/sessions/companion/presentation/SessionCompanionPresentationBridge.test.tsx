import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPartialStorageModuleMock, renderScreen, standardCleanup } from '@/dev/testkit';
import {
    createSessionBoardActionsPort,
    projectSessionBoard,
    type SessionBoardSnapshot,
} from '@/sync/domains/session/board';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import { SessionBoardContinuityProvider } from '../../board/SessionBoardContinuity';
import {
    SessionBoardControllerOwner,
} from '../../board/SessionBoardControllerProvider';
import type { SessionBoardBinding } from '../../board/observeSessionBoard';
import { SessionCompanionPresentationBridge } from './SessionCompanionPresentationBridge';
import type {
    SessionPresentationIntentApplier,
} from './SessionCompanionPresentationBridge';

const local = vi.hoisted(() => ({ stored: undefined as unknown }));

vi.mock('@/sync/domains/state/storage', async (importOriginal) =>
    createPartialStorageModuleMock(importOriginal, {
        useSessionCompanionPreferenceSlot: (sessionId: string | null, serverId?: string | null) => ({
            storageKey: sessionId && serverId ? `${serverId}:${sessionId}` : null,
            stored: local.stored,
        }),
        useMutateSessionCompanionPreference: () => (
            _sessionId: string,
            updater: (stored: unknown) => unknown,
            serverId?: string | null,
        ) => {
            if (!serverId) return false;
            const next = updater(local.stored);
            if (next === null) return false;
            local.stored = next;
            return true;
        },
    }),
);

const OWNER_ADDRESS: SessionAddress = { serverId: 'home-1', sessionId: 'session-1' };
const actions = createSessionBoardActionsPort(OWNER_ADDRESS);
const pluginRuntime = {
    pluginUiProjection: null,
    pluginBrowserProjection: null,
    phase: 'unavailable' as const,
    interactionEnabled: false,
    machineId: null,
    serverId: OWNER_ADDRESS.serverId,
    platform: 'web' as const,
};

// Reachability and repository freshness are separate axes on purpose: a
// reachable Home with a stale repository is the ordinary state right after any
// Board write, and the bridge must be able to see them apart.
function snapshot(
    reachability: SessionBoardSnapshot['reachability'],
    freshness: SessionBoardSnapshot['freshness'],
): SessionBoardSnapshot {
    return projectSessionBoard({
        layout: undefined,
        items: new Map(),
        capabilities: { readTranscript: true, editSessionRecords: true },
        freshness,
        reachability,
        loading: 'idle',
        incomplete: false,
    });
}

function Harness(props: Readonly<{
    binding: SessionBoardBinding;
    bridgeAddress?: SessionAddress;
    applierRef: React.MutableRefObject<SessionPresentationIntentApplier | null>;
    openBoard: ReturnType<typeof vi.fn>;
}>): React.ReactElement {
    const bridgeAddress = props.bridgeAddress ?? OWNER_ADDRESS;
    return (
        <SessionBoardContinuityProvider
            sessionId={OWNER_ADDRESS.sessionId}
            serverId={OWNER_ADDRESS.serverId}
        >
            <SessionBoardControllerOwner
                address={OWNER_ADDRESS}
                input={{
                    sessionId: OWNER_ADDRESS.sessionId,
                    serverId: OWNER_ADDRESS.serverId,
                    binding: props.binding,
                    actions,
                }}
                binding={props.binding}
                actions={actions}
                pluginRuntime={pluginRuntime}
                callerHostedHtmlRuntime={null}
            >
                <SessionCompanionPresentationBridge
                    sessionId={bridgeAddress.sessionId}
                    serverId={bridgeAddress.serverId}
                    applierRef={props.applierRef}
                    openBoard={props.openBoard}
                    revealBoardItem={() => ({ status: 'applied' })}
                    returnToChat={() => ({ status: 'applied' })}
                    openFullSurface={() => ({ status: 'applied' })}
                />
            </SessionBoardControllerOwner>
        </SessionBoardContinuityProvider>
    );
}

describe('SessionCompanionPresentationBridge Board currentness', () => {
    beforeEach(() => {
        local.stored = undefined;
    });
    afterEach(() => standardCleanup());

    it.each([
        ['feature-disabled', { status: 'unavailable', reason: 'board_feature_disabled' } as const, OWNER_ADDRESS],
        ['forbidden or revoked', { status: 'unavailable', reason: 'forbidden' } as const, OWNER_ADDRESS],
        ['offline', { status: 'ready', snapshot: snapshot('offline', 'stale') } as const, OWNER_ADDRESS],
        ['unknown reachability', { status: 'ready', snapshot: snapshot('unknown', 'stale') } as const, OWNER_ADDRESS],
        ['wrong exact address', { status: 'ready', snapshot: snapshot('reachable', 'fresh') } as const, {
            serverId: 'home-2',
            sessionId: OWNER_ADDRESS.sessionId,
        }],
    ])('refuses Board presentation without pane mutation when %s', async (_label, binding, bridgeAddress) => {
        const applierRef = { current: null } as React.MutableRefObject<SessionPresentationIntentApplier | null>;
        const openBoard = vi.fn(() => ({ status: 'applied' as const }));
        await renderScreen(
            <Harness
                binding={binding}
                bridgeAddress={bridgeAddress}
                applierRef={applierRef}
                openBoard={openBoard}
            />,
        );

        expect(applierRef.current?.({ kind: 'board.open', mode: 'beside_chat' }))
            .toEqual({ status: 'unavailable' });
        expect(openBoard).not.toHaveBeenCalled();
    });

    // Freshness is not authorization. An Agent's own Board write marks the
    // repository stale before it reveals what it made; last-known Board
    // content stays a valid navigation target while its Home is reachable.
    it.each([
        ['fresh', 'fresh'],
        ['stale', 'stale'],
    ] as const)('applies Board presentation through the reachable exact-Session binding when its repository is %s', async (_label, freshness) => {
        const applierRef = { current: null } as React.MutableRefObject<SessionPresentationIntentApplier | null>;
        const openBoard = vi.fn(() => ({ status: 'applied' as const }));
        await renderScreen(
            <Harness
                binding={{ status: 'ready', snapshot: snapshot('reachable', freshness) }}
                applierRef={applierRef}
                openBoard={openBoard}
            />,
        );

        expect(applierRef.current?.({ kind: 'board.open', mode: 'focus' }))
            .toEqual({ status: 'applied' });
        expect(openBoard).toHaveBeenCalledWith('focus');
    });

    it('keeps Companion-only intents independent of unavailable Board currentness', async () => {
        const applierRef = { current: null } as React.MutableRefObject<SessionPresentationIntentApplier | null>;
        const openBoard = vi.fn(() => ({ status: 'applied' as const }));
        await renderScreen(
            <Harness
                binding={{ status: 'unavailable', reason: 'board_feature_disabled' }}
                applierRef={applierRef}
                openBoard={openBoard}
            />,
        );

        expect(applierRef.current?.({ kind: 'companion.show' })).toEqual({ status: 'applied' });
        expect(openBoard).not.toHaveBeenCalled();
    });
});
