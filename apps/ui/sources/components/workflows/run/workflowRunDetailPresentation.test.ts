import { describe, expect, it } from 'vitest';

import {
    createWorkflowInvocationIndexFixture,
    createWorkflowRunSummaryFixture,
} from '@/dev/testkit/fixtures/workflowRunFixtures';

import {
    describeWorkflowInvocationLifecycle,
    describeWorkflowRunState,
    isTerminalWorkflowRunState,
    summarizeWorkflowInvocationCoverage,
} from '@/components/workflows/presentation/workflowLifecyclePresentation';

import {
    canOfferWorkflowInvocationReattach,
    formatWorkflowRunOutcomeLabel,
    formatWorkflowWorkspaceSourceLabel,
    isObservedCompletionTransition,
    projectWorkflowInvocationRecovery,
} from './workflowRunDetailPresentation';

describe('managed workflow Run presentation', () => {
    it('keeps parent state and invocation lifecycle as separate vocabularies', () => {
        // `interrupted` exists only on the parent; `waiting_for_approval` only
        // on an invocation. Neither mapper may accept the other's value.
        expect(describeWorkflowRunState('interrupted').variant).toBe('warning');
        expect(describeWorkflowInvocationLifecycle('waiting_for_approval').variant).toBe('warning');
        expect(describeWorkflowRunState('paused').variant).toBe('neutral');
        // `queued` and `claimed` are the incumbent Automation parent states the
        // workflow enum extends; they are not an invocation lifecycle.
        expect(describeWorkflowRunState('queued').variant).toBe('info');
        expect(describeWorkflowInvocationLifecycle('superseded').variant).toBe('neutral');
    });

    it('excludes superseded attempts from coverage so a retried step is counted once', () => {
        const coverage = summarizeWorkflowInvocationCoverage([
            createWorkflowInvocationIndexFixture({ id: 'a', lifecycle: 'failed' }),
            createWorkflowInvocationIndexFixture({ id: 'a-retry', lifecycle: 'superseded' }),
            createWorkflowInvocationIndexFixture({ id: 'b', lifecycle: 'completed' }),
            createWorkflowInvocationIndexFixture({ id: 'c', lifecycle: 'waiting_for_approval' }),
        ]);

        expect(coverage).toEqual({ completed: 1, failed: 1, attention: 1 });
    });

    it('reads a structurally successful Run with failed children as done with failures', () => {
        const label = formatWorkflowRunOutcomeLabel({
            state: 'succeeded',
            coverage: { completed: 3, failed: 1, attention: 0 },
        });

        // Never "all passed" because the container structurally completed.
        expect(label).not.toBe(formatWorkflowRunOutcomeLabel({
            state: 'succeeded',
            coverage: { completed: 4, failed: 0, attention: 0 },
        }));
    });

    it('treats a false check result as data, not execution failure', () => {
        // A `{ passed: false }` step still completes, so coverage sees no failure
        // and the Run does not read as "done with failures".
        const coverage = summarizeWorkflowInvocationCoverage([
            createWorkflowInvocationIndexFixture({ id: 'check', lifecycle: 'completed' }),
        ]);

        expect(coverage.failed).toBe(0);
    });

    it('classifies terminal states exactly', () => {
        expect(isTerminalWorkflowRunState('succeeded')).toBe(true);
        expect(isTerminalWorkflowRunState('outcome_uncertain')).toBe(true);
        // Boundary paused and interrupted remain recoverable, not terminal.
        expect(isTerminalWorkflowRunState('paused')).toBe(false);
        expect(isTerminalWorkflowRunState('interrupted')).toBe(false);
    });

    it('fires the completion moment only on an observed nonterminal to success transition', () => {
        expect(isObservedCompletionTransition({ previousState: 'running', nextState: 'succeeded' })).toBe(true);
        // First render of an already finished Run, and re-entry, must not replay it.
        expect(isObservedCompletionTransition({ previousState: null, nextState: 'succeeded' })).toBe(false);
        expect(isObservedCompletionTransition({ previousState: 'succeeded', nextState: 'succeeded' })).toBe(false);
        // A terminal failure is not the success moment.
        expect(isObservedCompletionTransition({ previousState: 'running', nextState: 'failed' })).toBe(false);
    });

    it('describes a direct Run without inventing a Session it does not have', () => {
        const withoutSession = createWorkflowRunSummaryFixture({ origin: { kind: 'direct' } });
        const withSession = createWorkflowRunSummaryFixture({
            origin: { kind: 'direct', originSessionId: 'session-1' },
        });

        expect(withoutSession.origin.kind).toBe('direct');
        expect(withSession.origin).toMatchObject({ originSessionId: 'session-1' });
    });

    it('offers reattach only for a canonically surviving selected input', () => {
        const run = createWorkflowRunSummaryFixture({
            state: 'interrupted',
            availability: { recoverSameConversation: true, recoverFreshAgent: true },
        });
        const execution = {
            kind: 'session' as const,
            sessionId: 'session-1',
            localInputId: 'input-1',
        };

        expect(canOfferWorkflowInvocationReattach({
            run,
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'running' }),
            progress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step',
                attempt: '0',
                logicalInvocationRecordId: 'invocation-1',
                execution,
            },
        })).toBe(true);

        // Recovery availability also covers continuation with a stopped input;
        // it must not be treated as evidence that the old input can reattach.
        expect(canOfferWorkflowInvocationReattach({
            run,
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'failed' }),
            progress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step',
                attempt: '0',
                logicalInvocationRecordId: 'invocation-1',
                execution,
            },
        })).toBe(false);

        // Fresh-agent continuation starts a different execution. It never
        // proves the old input survived and therefore cannot expose Reattach.
        expect(canOfferWorkflowInvocationReattach({
            run: createWorkflowRunSummaryFixture({
                state: 'interrupted',
                availability: { recoverSameConversation: false, recoverFreshAgent: true },
            }),
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'running' }),
            progress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step',
                attempt: '0',
                logicalInvocationRecordId: 'invocation-1',
                execution,
            },
        })).toBe(false);
    });

    it('projects recovery actions from the exact selected row instead of broad Run availability', () => {
        const run = createWorkflowRunSummaryFixture({
            state: 'interrupted',
            availability: {
                recoverSameConversation: true,
                recoverFreshAgent: true,
                retry: true,
                inspectExecution: true,
            },
        });
        const progress = {
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: { blockId: 'analyze', scope: [] },
            blockKind: 'step' as const,
            attempt: '0',
            logicalInvocationRecordId: 'invocation-1',
            execution: { kind: 'session' as const, sessionId: 'session-1', localInputId: 'input-1' },
            workspace: {
                descriptor: {
                    machineId: 'machine-1',
                    directory: '/Users/alice/project',
                    checkoutRootPath: '/Users/alice/project',
                    workspaceRefId: 'workspace-1',
                    checkout: { kind: 'git_worktree' as const, branchName: 'workflow/analyze' },
                },
            },
        };

        const active = projectWorkflowInvocationRecovery({
            run,
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'running' }),
            progress,
            machineHomeDirectory: '/Users/alice',
        });
        expect(active).toMatchObject({
            canInspectExecution: true,
            canReattach: true,
            canRetrySameConversation: false,
            canRetryFreshAgent: false,
            waitingForStop: false,
            workspaceUnavailable: false,
            workspace: {
                directory: '/Users/alice/project',
                displayDirectory: '~/project',
                workspaceRefId: 'workspace-1',
                branchName: 'workflow/analyze',
            },
        });

        const stopped = projectWorkflowInvocationRecovery({
            run,
            invocation: createWorkflowInvocationIndexFixture({ id: 'selected', parentRecordId: 'parent', lifecycle: 'failed' }),
            progress: { ...progress, execution: undefined },
            machineHomeDirectory: '/Users/alice',
            invocationHistoryComplete: true,
            invocations: [
                createWorkflowInvocationIndexFixture({ id: 'selected', parentRecordId: 'parent', lifecycle: 'failed' }),
                createWorkflowInvocationIndexFixture({ id: 'waiting', parentRecordId: 'parent', lifecycle: 'pending' }),
                createWorkflowInvocationIndexFixture({ id: 'other-parent', parentRecordId: null, lifecycle: 'pending' }),
            ],
        });
        expect(stopped).toMatchObject({
            canInspectExecution: false,
            canReattach: false,
            canRetrySameConversation: true,
            canRetryFreshAgent: true,
            remainingNotStartedSiblingCount: 1,
        });

        // Run-level retry availability never makes an unrelated completed row retryable.
        expect(projectWorkflowInvocationRecovery({
            run,
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'completed' }),
            progress,
            machineHomeDirectory: '/Users/alice',
        })).toMatchObject({ canRetrySameConversation: false, canRetryFreshAgent: false });
    });

    it('keeps possibly active work blocked and treats a missing workspace as a distinct recovery fact', () => {
        const run = createWorkflowRunSummaryFixture({
            state: 'interrupted',
            workflowCustodyState: 'pending',
            availability: { recoverSameConversation: true, recoverFreshAgent: true, retry: true },
        });
        const projection = projectWorkflowInvocationRecovery({
            run,
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'outcome_uncertain' }),
            progress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'invocation-1',
                reason: { code: 'workspace_unavailable' },
            },
            machineHomeDirectory: null,
        });

        expect(projection).toMatchObject({
            waitingForStop: true,
            workspaceUnavailable: true,
            workspace: null,
            canReattach: false,
            canRetrySameConversation: false,
            canRetryFreshAgent: false,
        });

        expect(projectWorkflowInvocationRecovery({
            run,
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'failed' }),
            progress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'invocation-1',
                reason: { code: 'conversation_workspace_mismatch' },
            },
            machineHomeDirectory: null,
        })).toMatchObject({ workspaceUnavailable: true, canRetrySameConversation: false });
    });

    it('offers exact workspace restoration only from canonical public and private evidence', () => {
        const invocation = createWorkflowInvocationIndexFixture({ lifecycle: 'failed' });
        const restorableProgress = {
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: { blockId: 'analyze', scope: [] },
            blockKind: 'step' as const,
            attempt: '0',
            logicalInvocationRecordId: invocation.id,
            reason: { code: 'workspace_unavailable' },
            workspace: {
                creationIntent: {
                    kind: 'git_worktree' as const,
                    sourceDirectory: '/Users/alice/project',
                    baseRef: 'a'.repeat(40),
                    displayName: 'workflow-analyze',
                    branchMode: 'new' as const,
                },
                descriptor: {
                    machineId: 'machine-1',
                    directory: '/Users/alice/project/.worktrees/workflow-analyze',
                    checkoutRootPath: '/Users/alice/project/.worktrees/workflow-analyze',
                    checkout: { kind: 'git_worktree' as const, branchName: 'workflow-analyze' },
                },
            },
        };
        const run = createWorkflowRunSummaryFixture({
            state: 'interrupted',
            availability: { restoreWorkspace: true },
        });

        expect(projectWorkflowInvocationRecovery({
            run, invocation, progress: restorableProgress, machineHomeDirectory: '/Users/alice',
        }).canRestoreWorkspace).toBe(true);
        expect(projectWorkflowInvocationRecovery({
            run: { ...run, availability: { ...run.availability, restoreWorkspace: false } },
            invocation, progress: restorableProgress, machineHomeDirectory: '/Users/alice',
        }).canRestoreWorkspace).toBe(false);
        expect(projectWorkflowInvocationRecovery({
            run, invocation,
            progress: { ...restorableProgress, workspace: { descriptor: restorableProgress.workspace.descriptor } },
            machineHomeDirectory: '/Users/alice',
        }).canRestoreWorkspace).toBe(false);
    });

    /**
     * D4 offers exactly one of two things. Restoring resumes the same Run and
     * keeps its completed work; a reviewed new whole Run repeats it. Offering
     * both at once asked the person to choose between recovering and repeating
     * without saying that one of them was strictly better.
     */
    it('offers a reviewed new Run only when same-Run restoration is impossible', () => {
        const invocation = createWorkflowInvocationIndexFixture({ lifecycle: 'failed' });
        const restorableProgress = {
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: { blockId: 'analyze', scope: [] },
            blockKind: 'step' as const,
            attempt: '0',
            logicalInvocationRecordId: invocation.id,
            reason: { code: 'workspace_unavailable' },
            workspace: {
                creationIntent: {
                    kind: 'git_worktree' as const,
                    sourceDirectory: '/Users/alice/project',
                    baseRef: 'a'.repeat(40),
                    displayName: 'workflow-analyze',
                    branchMode: 'new' as const,
                },
                descriptor: {
                    machineId: 'machine-1',
                    directory: '/Users/alice/project/.worktrees/workflow-analyze',
                    checkoutRootPath: '/Users/alice/project/.worktrees/workflow-analyze',
                    checkout: { kind: 'git_worktree' as const, branchName: 'workflow-analyze' },
                },
            },
        };
        const run = createWorkflowRunSummaryFixture({
            state: 'interrupted',
            // Settled custody is exactly the state in which both offers were
            // live together: nothing is waiting for a stop to be confirmed.
            workflowCustodyState: 'settled',
            availability: { restoreWorkspace: true },
        });

        const restorable = projectWorkflowInvocationRecovery({
            run, invocation, progress: restorableProgress, machineHomeDirectory: '/Users/alice',
        });
        expect(restorable).toMatchObject({ canRestoreWorkspace: true, canStartReviewedNewRun: false });

        // No restoration producer: the only truthful offer left is a reviewed
        // new whole Run.
        const unrestorable = projectWorkflowInvocationRecovery({
            run,
            invocation,
            progress: { ...restorableProgress, workspace: { descriptor: restorableProgress.workspace.descriptor } },
            machineHomeDirectory: '/Users/alice',
        });
        expect(unrestorable).toMatchObject({ canRestoreWorkspace: false, canStartReviewedNewRun: true });

        // Every workspace-unavailable reason reaches the same pair of offers.
        expect(projectWorkflowInvocationRecovery({
            run,
            invocation,
            progress: {
                ...restorableProgress,
                reason: { code: 'source_workspace_unavailable' },
                workspace: { descriptor: restorableProgress.workspace.descriptor },
            },
            machineHomeDirectory: '/Users/alice',
        })).toMatchObject({ canRestoreWorkspace: false, canStartReviewedNewRun: true });
    });

    it('withholds the reviewed new Run while the previous input may still be running', () => {
        const run = createWorkflowRunSummaryFixture({
            state: 'interrupted',
            workflowCustodyState: 'pending',
            availability: { restoreWorkspace: true },
        });

        const projection = projectWorkflowInvocationRecovery({
            run,
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'outcome_uncertain' }),
            progress: {
                kind: 'happier.workflow-progress.v1',
                invocationPath: { blockId: 'analyze', scope: [] },
                blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'invocation-1',
                reason: { code: 'workspace_unavailable' },
            },
            machineHomeDirectory: null,
        });

        expect(projection).toMatchObject({
            waitingForStop: true,
            canRestoreWorkspace: false,
            canStartReviewedNewRun: false,
        });
    });

    it('offers no reviewed new Run when the workspace is fine', () => {
        expect(projectWorkflowInvocationRecovery({
            run: createWorkflowRunSummaryFixture({ state: 'interrupted' }),
            invocation: createWorkflowInvocationIndexFixture({ lifecycle: 'failed' }),
            progress: null,
            machineHomeDirectory: null,
        })).toMatchObject({ workspaceUnavailable: false, canStartReviewedNewRun: false });
    });

    it('projects the exact source invocation identity for iteration-safe workspace display', () => {
        const progress = {
            kind: 'happier.workflow-progress.v1' as const,
            invocationPath: { blockId: 'implement', scope: [] },
            blockKind: 'step' as const,
            attempt: '0',
            logicalInvocationRecordId: 'invocation-2',
            workspace: { descriptor: {
                machineId: 'machine-1',
                directory: '/worktrees/implement',
                checkoutRootPath: '/worktrees/implement',
                sourceInvocation: {
                    producer: { blockId: 'analyze', scope: { kind: 'current' as const } },
                    invocationRecordId: 'inv-analyze-iteration-7',
                },
            } },
        };

        expect(projectWorkflowInvocationRecovery({
            run: createWorkflowRunSummaryFixture(),
            invocation: createWorkflowInvocationIndexFixture(),
            progress,
            machineHomeDirectory: null,
        }).workspace).toMatchObject({
            sourceBlockId: 'analyze',
            sourceInvocationRecordId: 'inv-analyze-iteration-7',
        });
        expect(formatWorkflowWorkspaceSourceLabel('Analyze', 'inv-analyze-iteration-7'))
            .toBe('Analyze · inv-analyze-iteration-7');
    });
});
