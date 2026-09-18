import { describe, expect, it } from 'vitest';

import {
    createExecutionRunDetailsTab,
    createDiscussionSelectionInteractiveExecutionRunDraftDetailsTab,
    createInteractiveExecutionRunDraftDetailsTab,
    resolveExecutionRunLauncherIntent,
} from './executionRunLauncherModel';

describe('execution Run conversation details resources', () => {
    it('keeps an unmaterialized conversation distinct from a bounded launcher and replaces it with the exact Run resource', () => {
        expect(createInteractiveExecutionRunDraftDetailsTab()).toMatchObject({
            key: 'execution-run-conversation-draft',
            resource: { kind: 'executionRunLauncher', mode: 'conversation' },
        });
        expect(createExecutionRunDetailsTab('run_1')).toMatchObject({
            key: 'execution-run:run_1',
            resource: { kind: 'executionRun', runId: 'run_1' },
        });
        expect(createExecutionRunDetailsTab('run_1', { retryInputLocalId: 'first-input-1' })).toMatchObject({
            key: 'execution-run:run_1',
            resource: {
                kind: 'executionRun',
                runId: 'run_1',
                retryInputLocalId: 'first-input-1',
            },
        });
    });

    it('keeps Discussion selection provenance and prefill on the same conversation draft resource', () => {
        const source = {
            kind: 'session_discussion' as const,
            sessionId: 'session_1',
            discussionId: 'discussion_1',
            messageIds: ['message_1'],
            draftCorrelationId: 'draft_1',
        };
        expect(createDiscussionSelectionInteractiveExecutionRunDraftDetailsTab({ source, initialText: 'Investigate this' })).toMatchObject({
            key: 'execution-run-conversation-draft:discussion:draft_1',
            resource: { kind: 'executionRunLauncher', mode: 'conversation', source, initialInstructions: 'Investigate this' },
        });
    });
});

describe('resolveExecutionRunLauncherIntent', () => {
    it('keeps supported launcher intents and rejects valid but unsupported execution-run intents', () => {
        expect(resolveExecutionRunLauncherIntent('review')).toBe('review');
        expect(resolveExecutionRunLauncherIntent('plan')).toBe('plan');
        expect(resolveExecutionRunLauncherIntent('delegate')).toBe('delegate');
        expect(resolveExecutionRunLauncherIntent('voice_agent')).toBeNull();
        expect(resolveExecutionRunLauncherIntent('memory_hints')).toBeNull();
    });

    it('rejects unknown intents instead of rewriting them', () => {
        expect(resolveExecutionRunLauncherIntent('bogus')).toBeNull();
        expect(resolveExecutionRunLauncherIntent({ intent: 'delegate' })).toBeNull();
    });
});
