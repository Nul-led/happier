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
            .toMatchObject({ statusLabel: 'Timed out', statusVariant: 'warning' });
        expect(resolveSessionAgentActivityPresentation({ entry: entry({ status: 'succeeded' }) }))
            .toMatchObject({ statusLabel: 'Done', statusVariant: 'success' });
        expect(resolveSessionAgentActivityPresentation({ entry: entry({ status: 'failed' }) }).statusVariant)
            .toBe('danger');
    });

    it('reads the merged status, never the local subagent status a host might still hold', () => {
        const presentation = resolveSessionAgentActivityPresentation({
            entry: entry({ status: 'succeeded' }),
            subagent: subagent({ status: 'running' }),
        });

        expect(presentation.statusLabel).toBe('Done');
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
        expect(presentation.facts).toContain('run_1');
    });
});
