import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Session } from '@/sync/domains/state/storageTypes';
import { getSessionSubagentLaunchCards } from './sessionSubagentUiBehavior';

vi.mock('./agentUiBehavior/AgentInlineSurface', () => ({
    AgentInlineSurface: () => null,
}));

vi.mock('@/sync/domains/session/readSessionOwnerMetadataView', () => ({
    readSessionOwnerMetadataView: () => ({}),
}));

vi.mock('@/agents/registry/registryUiBehavior', () => ({
    resolveAgentUiBehaviorFromSessionMetadata: () => ({
        sessionSubagents: {
            renderLaunchCards: ({ renderInlineSurface }: Readonly<{
                renderInlineSurface: (surface: Readonly<{
                    slotId: string;
                    pluginId: string;
                    surfaceId: string;
                    sessionId: string;
                    agentId: string;
                }>) => React.ReactNode;
            }>) => [renderInlineSurface({
                slotId: 'fixture.launch-card',
                pluginId: 'happier.agent.fixture',
                surfaceId: 'subagent-launch',
                sessionId: 'duplicate-session-id',
                agentId: 'happier.agent.fixture',
            })],
        },
    }),
}));

describe('getSessionSubagentLaunchCards', () => {
    it('qualifies launch-card inline surfaces with the supplied Session Home', () => {
        const session = {
            id: 'duplicate-session-id',
            serverId: 'server-a',
        } as Session;

        const cards = getSessionSubagentLaunchCards({
            sessionId: session.id,
            scopeId: `session:${session.id}`,
            session,
            subagents: [],
        });

        expect(cards).toHaveLength(1);
        const card = cards[0];
        expect(React.isValidElement(card)).toBe(true);
        if (!React.isValidElement<Readonly<{ sessionId: string; serverId?: string | null }>>(card)) {
            throw new Error('launch card must be a React element');
        }

        // The same local Session id may exist on server-b. The adapter must
        // carry server-a from the supplied Session instead of allowing the
        // inline host to resolve through ambient/focused-Home state.
        expect(card.props.sessionId).toBe('duplicate-session-id');
        expect(card.props.serverId).toBe('server-a');
    });
});
