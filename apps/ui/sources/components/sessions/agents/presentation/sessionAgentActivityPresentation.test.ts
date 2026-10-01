import { describe, expect, it } from 'vitest';

import {
    NO_SESSION_AGENT_ACTIVITY_ATTENTION,
    type AgentActivityEntry,
} from '@/sync/domains/session/agentActivity';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';

import { resolveSessionAgentActivityPresentation } from './sessionAgentActivityPresentation';

function entry(overrides: Partial<AgentActivityEntry> = {}): AgentActivityEntry {
    return {
        id: 'execution_run:run_1',
        kind: 'execution_run',
        status: 'running',
        title: 'Published title',
        metaDetail: null,
        startedAtMs: null,
        endedAtMs: null,
        provenance: 'merged',
        detailState: 'loaded',
        parentId: null,
        runId: 'run_1',
        sidechainId: null,
        subagentId: 'execution_run:run_1',
        attentionKinds: NO_SESSION_AGENT_ACTIVITY_ATTENTION,
        ...overrides,
    };
}

function subagent(overrides: Partial<SessionSubagent> = {}): SessionSubagent {
    return {
        id: 'execution_run:run_1',
        kind: 'execution_run',
        status: 'running',
        display: { title: 'Local title', providerLabel: 'Claude' },
        transcript: {},
        recipient: null,
        capabilities: {
            canOpen: true,
            canSend: false,
            canStop: false,
            canLaunchChild: false,
            canDelete: false,
            canOpenAdvancedRun: false,
        },
        timestamps: {},
        runRef: { runId: 'run_1' },
        ...overrides,
    };
}

describe('resolveSessionAgentActivityPresentation', () => {
    it('says a permission request needs approval', () => {
        const presentation = resolveSessionAgentActivityPresentation({
            entry: entry({ status: 'waiting', attentionKinds: ['permission'] }),
        });

        expect(presentation.attention).toMatchObject({ label: 'Needs approval', variant: 'warning' });
        expect(presentation.accessibilityLabel).toContain('Needs approval');
    });

    it('says an agent question needs an answer, which the boolean predecessor could never say', () => {
        const presentation = resolveSessionAgentActivityPresentation({
            entry: entry({ status: 'waiting', attentionKinds: ['user_action'] }),
        });

        expect(presentation.attention?.label).toBe('Needs your answer');
    });

    it('shows one concise label for both kinds while naming both to a screen reader', () => {
        const presentation = resolveSessionAgentActivityPresentation({
            entry: entry({ status: 'waiting', attentionKinds: ['permission', 'user_action'] }),
        });

        expect(presentation.attention?.label).toBe('Needs attention');
        expect(presentation.accessibilityLabel).toContain('Needs approval and needs your answer');
    });

    it('carries no attention when nothing is waiting on a person', () => {
        expect(resolveSessionAgentActivityPresentation({ entry: entry() }).attention).toBeNull();
    });

    it('translates the canonical status rather than painting a raw token on screen', () => {
        expect(resolveSessionAgentActivityPresentation({ entry: entry({ status: 'timedOut' }) }))
            .toMatchObject({ statusLabel: 'Timed out', statusTone: 'attention' });
        expect(resolveSessionAgentActivityPresentation({ entry: entry({ status: 'failed' }) }).statusTone)
            .toBe('danger');
    });

    it('takes its tone from the one work-status owner: healthy work is neutral, never green or blue (INT T4)', () => {
        for (const status of ['running', 'succeeded', 'queued', 'cancelled'] as const) {
            expect(resolveSessionAgentActivityPresentation({ entry: entry({ status }) }).statusTone).toBe('neutral');
        }
        expect(resolveSessionAgentActivityPresentation({ entry: entry({ status: 'succeeded' }) }).statusLabel).toBe('Completed');
        // Running is said by the activity ring and the clock; queued is still named.
        expect(resolveSessionAgentActivityPresentation({ entry: entry({ status: 'running' }) }).statusShownByActivity).toBe(true);
        expect(resolveSessionAgentActivityPresentation({ entry: entry({ status: 'queued' }) }).statusShownByActivity).toBe(false);
    });

    it('reads the merged status, never the local subagent status a host might still hold', () => {
        const presentation = resolveSessionAgentActivityPresentation({
            entry: entry({ status: 'succeeded' }),
            subagent: subagent({ status: 'running' }),
        });

        expect(presentation.statusLabel).toBe('Completed');
    });

    it('prefers the local title, and falls back to the entry title for an unloaded row', () => {
        expect(resolveSessionAgentActivityPresentation({ entry: entry(), subagent: subagent() }).title)
            .toBe('Local title');
        expect(resolveSessionAgentActivityPresentation({ entry: entry({ detailState: 'unloaded' }) }).title)
            .toBe('Published title');
    });

    it('never repeats a fact, and never shows a run id masquerading as a title', () => {
        const presentation = resolveSessionAgentActivityPresentation({
            entry: entry(),
            subagent: subagent({
                display: { title: 'run_1', providerLabel: 'Claude', subtitle: 'Claude' },
            }),
        });

        expect(presentation.title).not.toBe('run_1');
        expect(presentation.facts.filter((fact) => fact === 'Claude')).toHaveLength(1);
        // A named row never spells its run id; the id lives in the Run's details.
        expect(presentation.facts).not.toContain('run_1');
    });

    it('names a Run by what it is for — a Conversation, a Review, a Plan — never by its raw intent token', () => {
        const conversation = resolveSessionAgentActivityPresentation({
            entry: entry(),
            subagent: subagent({
                display: { title: 'Is 5 attempts enough?', providerLabel: 'Claude', subtitle: 'delegate' },
                runRef: { runId: 'run_1', intent: 'delegate', runClass: 'long_lived' },
            }),
        });
        expect(conversation.facts[0]).toBe('Conversation');
        expect(conversation.facts).not.toContain('delegate');

        const review = resolveSessionAgentActivityPresentation({
            entry: entry(),
            subagent: subagent({
                display: { title: 'Review #2481 changes', subtitle: 'review' },
                runRef: { runId: 'run_1', intent: 'review', runClass: 'bounded' },
            }),
        });
        expect(review.facts[0]).toBe('Review');
        expect(review.facts).not.toContain('review');
    });

    it('says where a Run came from, right after what it is, when the host knows the origin', () => {
        const presentation = resolveSessionAgentActivityPresentation({
            entry: entry(),
            subagent: subagent({ runRef: { runId: 'run_1', intent: 'delegate', runClass: 'long_lived' } }),
            originLabel: 'from Relay retry plan',
        });

        expect(presentation.facts.slice(0, 2)).toEqual(['Conversation', 'from Relay retry plan']);
    });
});
