import { describe, expect, it } from 'vitest';
import { AutomationRunCauseSchema } from '@happier-dev/protocol';

import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { installSessionSubagentCommonModuleMocks } from '@/components/sessions/agents/sessionSubagentTestHelpers';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

installSessionSubagentCommonModuleMocks();

describe('the Session Work source owner: own trigger runs (ORC R-09, INT §6 I4)', () => {
    it("leaves the Session's own trigger runs to Triggers, by their Automation's scope, in Work and in the header count", async () => {
        const { readOwnTriggerRunIds } = await import('./sessionWorkSources');
        const { projectWork } = await import('./workProjection');
        const triggerCause = AutomationRunCauseSchema.parse({
            kind: 'trigger', triggerId: 'retired-trigger', triggerRevision: 1,
            triggerKind: 'sessionLifecycle', occurrenceKey: 'A'.repeat(43), occurredAt: 10,
            evidence: { event: 'parentTurnCompleted', sourceSessionId: 'lead', sourceTurnId: 'turn-1', policy: { kind: 'everyMatch' } },
        });
        const runs = [
            // Started directly from this Session (an agent's on-the-fly workflow): Work.
            createWorkflowRunSummaryFixture({ id: 'ordinary', origin: { kind: 'direct', originSessionId: 'lead' } }),
            // Started by an Automation scoped to this Session — one of its triggers: Triggers.
            createWorkflowRunSummaryFixture({ id: 'own-trigger', origin: { kind: 'automation', automationId: 'lead-trigger', originSessionId: 'lead', cause: triggerCause } }),
            createWorkflowRunSummaryFixture({ id: 'own-conversation-trigger', origin: { kind: 'automation', automationId: 'lead-trigger', cause: AutomationRunCauseSchema.parse({ kind: 'conversation', triggerId: 'conversation-trigger', occurrenceKey: 'A'.repeat(43), occurredAt: 10 }) } }),
            // Same scoped Automation, but no trigger caused these Runs. Do not guess from scope.
            createWorkflowRunSummaryFixture({ id: 'manual', origin: { kind: 'automation', automationId: 'lead-trigger', originSessionId: 'lead', cause: { kind: 'manual', invokedAt: 10 } } }),
            createWorkflowRunSummaryFixture({ id: 'unknown-cause', origin: { kind: 'automation', automationId: 'lead-trigger', originSessionId: 'lead' } }),
            createWorkflowRunSummaryFixture({ id: 'conversation', origin: { kind: 'automation', automationId: 'lead-trigger', originSessionId: 'lead', cause: AutomationRunCauseSchema.parse({ kind: 'conversation', occurrenceKey: 'B'.repeat(42) + 'A', occurredAt: 10 }) } }),
            // An Automation scoped to another Session, or to the Account, that names this Session: Work.
            createWorkflowRunSummaryFixture({ id: 'other-trigger', origin: { kind: 'automation', automationId: 'other-trigger', originSessionId: 'lead', cause: triggerCause } }),
            createWorkflowRunSummaryFixture({ id: 'account-automation', origin: { kind: 'automation', automationId: 'account-automation', originSessionId: 'lead', cause: triggerCause } }),
        ];
        const ownTriggerRunIds = readOwnTriggerRunIds({
            sessionId: 'lead',
            runs,
            automations: {
                'lead-trigger': { scopeSessionId: 'lead' },
                'other-trigger': { scopeSessionId: 'elsewhere' },
                'account-automation': { scopeSessionId: null },
            },
        });
        expect([...ownTriggerRunIds]).toEqual(['own-trigger', 'own-conversation-trigger']);

        const projection = projectWork({
            sessionId: 'lead',
            reportSessions: [],
            agentEntries: [],
            workflowHeadlineRuns: [],
            managedRuns: runs.map((run) => ({ run, title: run.id, word: 'Running', needsAttention: false })),
            ownTriggerRunIds,
            describeAgentStatus: () => 'Working',
            describeProgress: ({ completed, total }) => `${completed} of ${total}`,
        });
        expect(projection.workflows.map((item) => item.key).sort()).toEqual(['run:account-automation', 'run:conversation', 'run:manual', 'run:ordinary', 'run:other-trigger', 'run:unknown-cause']);
        expect(projection.summary.runs).toBe(6);
    });
});
