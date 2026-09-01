import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installSessionHandoffCommonModuleMocks } from './sessionHandoffTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionHandoffCommonModuleMocks();

vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: (props: Record<string, unknown>) => React.createElement('RoundButton', props),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('Item', props, props.children),
}));

vi.mock('@/components/ui/lists/ExpandableItem', () => ({
    ExpandableItem: (props: React.PropsWithChildren<{
        expanded: boolean;
        onExpandedChange: (next: boolean) => void;
        header: (state: Readonly<{
            expanded: boolean;
            headerProps: Readonly<{
                onPress: () => void;
                accessibilityRole: 'button';
                accessibilityState: Readonly<{ expanded: boolean }>;
            }>;
        }>) => React.ReactNode;
    }>) => React.createElement(
        'ExpandableItem',
        props,
        props.header({
            expanded: props.expanded,
            headerProps: {
                onPress: () => props.onExpandedChange(!props.expanded),
                accessibilityRole: 'button',
                accessibilityState: { expanded: props.expanded },
            },
        }),
        props.expanded ? props.children : null,
    ),
}));

function findProgressIndicators(screen: Awaited<ReturnType<typeof renderScreen>>) {
    return screen.findAll((node) => node.props?.accessibilityRole === 'progressbar');
}

async function expandProgressDetails(screen: Awaited<ReturnType<typeof renderScreen>>) {
    const toggle = screen.findByTestId('session-handoff-progress-details-toggle');
    if (toggle?.props.accessibilityState?.expanded !== true) {
        await screen.pressByTestIdAsync('session-handoff-progress-details-toggle');
    }
}

describe('SessionHandoffProgressModal', () => {
    it('uses three localized primary stages and keeps technical operation details behind one disclosure', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                operation={{
                    version: 1,
                    operationId: 'handoff-operation-primary-progress',
                    requestId: 'request-primary-progress',
                    revision: 3,
                    actionId: 'session.handoff',
                    state: 'running',
                    scope: { accountId: 'account-1', machineId: 'source-machine', sessionId: 'session-1' },
                    title: 'Hand off session',
                    createdAt: 1,
                    startedAt: 1,
                    progress: { kind: 'determinate', current: 1024, total: 4096, label: 'Packaging session state' },
                    cancellation: 'supported',
                }}
            />,
        );

        expect(screen.findByTestId('session-handoff-primary-step-preparing')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-primary-step-moving')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-primary-step-ready')).toBeTruthy();
        expect(screen.getTextContent()).toContain('sessionHandoff.progress.primary.preparing');
        expect(screen.getTextContent()).toContain('sessionHandoff.progress.primary.moving');
        expect(screen.getTextContent()).toContain('sessionHandoff.progress.primary.ready');
        expect(screen.findByTestId('session-handoff-primary-step-preparing')?.props.accessibilityState?.selected).toBe(true);
        expect(screen.findByTestId('session-handoff-operation-progress-bar')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-operation-progress-bar')?.props.accessibilityValue)
            .toEqual({ min: 0, max: 100, now: 25 });
        expect(screen.getTextContent()).not.toContain('Packaging session state');

        const detailsToggle = screen.findByTestId('session-handoff-progress-details-toggle');
        expect(detailsToggle?.props.accessibilityRole).toBe('button');
        expect(detailsToggle?.props.accessibilityState).toEqual({ expanded: false });
        await screen.pressByTestIdAsync('session-handoff-progress-details-toggle');

        expect(screen.getTextContent()).toContain('Packaging session state');
        expect(screen.getTextContent()).toContain('1.0 KB / 4.0 KB');
        expect(screen.findByTestId('session-handoff-progress-details')?.props.expanded).toBe(true);
    });

    it('shows a spinner while the modal is waiting for the first status update', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(
            <SessionHandoffProgressModal onClose={() => {}} setChrome={setChrome} />,
        );

        expect(setChrome).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'card',
                title: 'sessionHandoff.progress.title',
                testID: 'session-handoff-progress-modal',
            }),
        );
        expect(screen.getTextContent()).toContain('sessionHandoff.progress.message');
        expect(findProgressIndicators(screen)).toHaveLength(1);
    });

    it('shows determinate session-state packaging progress before workspace preparation begins', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                operation={{
                    version: 1,
                    operationId: 'handoff-operation-1',
                    requestId: 'request-1',
                    revision: 2,
                    actionId: 'session.handoff',
                    state: 'running',
                    scope: { accountId: 'account-1', machineId: 'source-machine', sessionId: 'session-1' },
                    title: 'Hand off session',
                    createdAt: 1,
                    startedAt: 1,
                    progress: { kind: 'determinate', current: 1024, total: 4096, label: 'Packaging session state' },
                    cancellation: 'supported',
                }}
            />,
        );

        expect(screen.findByTestId('session-handoff-operation-progress-bar')).toBeTruthy();
        expect(screen.getTextContent()).toContain('25');
        expect(screen.getTextContent()).not.toContain('Packaging session state');
        await expandProgressDetails(screen);
        expect(screen.getTextContent()).toContain('Packaging session state');
    });

    it('maps technical operation progress onto the localized Moving primary stage', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                workspaceSyncEnabled={false}
                operation={{
                    version: 1,
                    operationId: 'handoff-operation-1',
                    requestId: 'request-1',
                    revision: 3,
                    actionId: 'session.handoff',
                    state: 'running',
                    scope: { accountId: 'account-1', machineId: 'source-machine', sessionId: 'session-1' },
                    title: 'Hand off session',
                    createdAt: 1,
                    startedAt: 1,
                    progress: { kind: 'determinate', current: 1024, total: 4096, label: 'Transferring session data' },
                    cancellation: 'supported',
                }}
            />,
        );

        const preparing = screen.findByTestId('session-handoff-primary-step-preparing');
        const moving = screen.findByTestId('session-handoff-primary-step-moving');
        const ready = screen.findByTestId('session-handoff-primary-step-ready');

        expect(preparing?.props.accessibilityState?.checked).toBe(true);
        expect(moving?.props.accessibilityState?.selected).toBe(true);
        expect(ready?.props.accessibilityState?.selected).toBe(false);
        expect(moving?.findByProps({ testID: 'session-handoff-operation-progress-bar' })).toBeTruthy();
        expect(screen.getTextContent()).not.toContain('Transferring session data');
    });

    it('keeps completed session bytes anchored to the session transfer step while import begins', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                operation={{
                    version: 1,
                    operationId: 'handoff-operation-2',
                    requestId: 'request-2',
                    revision: 4,
                    actionId: 'session.handoff',
                    state: 'running',
                    scope: { accountId: 'account-1', machineId: 'source-machine', sessionId: 'session-1' },
                    title: 'Hand off session',
                    createdAt: 1,
                    startedAt: 1,
                    progress: { kind: 'determinate', current: 4096, total: 4096, label: 'Importing session state' },
                    cancellation: 'supported',
                }}
            />,
        );

        expect(screen.findByTestId('session-handoff-primary-step-moving')?.props.accessibilityState?.selected).toBe(true);
    });

    it('keeps technical workspace progress labels behind Details', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                workspaceSyncEnabled
                operation={{
                    version: 1,
                    operationId: 'handoff-operation-3',
                    requestId: 'request-3',
                    revision: 5,
                    actionId: 'session.handoff',
                    state: 'running',
                    scope: { accountId: 'account-1', machineId: 'source-machine', sessionId: 'session-1' },
                    title: 'Hand off session',
                    createdAt: 1,
                    startedAt: 1,
                    progress: { kind: 'determinate', current: 1024, total: 4096, label: 'Transferring workspace' },
                    cancellation: 'supported',
                }}
            />,
        );

        expect(screen.getTextContent()).not.toContain('Transferring workspace');
        await expandProgressDetails(screen);
        expect(screen.getTextContent()).toContain('Transferring workspace');
    });

    it('offers Resume for an interrupted handoff but never invokes it during passive render', async () => {
        const onResume = vi.fn();
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_interrupted_1',
                    jobId: 'prepare_job_1',
                    status: 'awaiting_user_resume',
                    phase: 'staging_target',
                    recoveryActions: [],
                }}
                onResume={onResume}
            />,
        );

        expect(onResume).not.toHaveBeenCalled();
        expect(screen.findByTestId('session-handoff-progress-resume')).toBeTruthy();
        await screen.pressByTestIdAsync('session-handoff-progress-resume');
        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('renders a full checkpoint timeline that matches the protocol checkpoint enum', async () => {
        const { SessionHandoffProgressCheckpointSchema } = await import('@happier-dev/protocol');
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_checkpoint_parity_1',
                    status: 'pending',
                    phase: 'preparing',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'scan_source',
                        planned: {},
                        transferred: {},
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        for (const checkpoint of SessionHandoffProgressCheckpointSchema.options) {
            expect(screen.findByTestId(`session-handoff-progress-checkpoint-${checkpoint}`)).toBeTruthy();
        }
    });

    it('renders workspace preflight summary and progress details from handoff status', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                setChrome={setChrome}
                status={{
                    handoffId: 'handoff_1',
                    status: 'pending',
                    phase: 'staging_target',
                    workspacePreflightSummary: {
                        addedPathsCount: 3,
                        changedPathsCount: 2,
                        removedPathsCount: 1,
                        totalBytes: 2048,
                    },
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'transfer_blobs',
                        planned: {
                            totalFiles: 6,
                            totalBytes: 2048,
                        },
                        transferred: {
                            files: 3,
                            bytes: 1024,
                            blobs: 2,
                        },
                        applied: {
                            files: 1,
                            bytes: 256,
                        },
                        remaining: {
                            files: 3,
                            bytes: 1024,
                        },
                        current: {
                            relativePath: 'README.md',
                        },
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        expect(setChrome).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'card',
                title: 'sessionHandoff.progress.title',
                testID: 'session-handoff-progress-modal',
            }),
        );
        expect(screen.findByTestId('session-handoff-progress-bar')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-percent')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-summary')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-stats')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-path')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-timeline')).toBeNull();
        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-summary')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-stats')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-bar')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-percent')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-path')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-timeline')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-stat-planned')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-stat-transferred')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-stat-remaining')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-stat-applied')).toBeTruthy();

        const currentCheckpointRow = screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs');
        expect(currentCheckpointRow?.props.accessibilityState?.selected).toBe(true);

        const textContent = screen.getTextContent();
        expect(textContent).toContain('+3');
        expect(textContent).toContain('~2');
        expect(textContent).toContain('-1');
        expect(textContent).toContain('2.0 KB');
        expect(screen.findByTestId('session-handoff-progress-bar')?.props.accessibilityValue)
            .toEqual({ min: 0, max: 100, now: 50 });
        expect(textContent).toContain('README.md');
        expect(textContent).toContain('sessionHandoff.progress.planned');
        expect(textContent).toContain('sessionHandoff.progress.transferred');
        expect(textContent).toContain('sessionHandoff.progress.remaining');
        expect(textContent).toContain('common.applied');
    });

    it('exposes determinate progress and changing status through polite accessibility semantics', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const createStatus = (transferredBytes: number, updatedAtMs: number) => ({
            handoffId: 'handoff_accessibility_1',
            status: 'in_progress' as const,
            phase: 'staging_target' as const,
            progress: {
                updatedAtMs,
                checkpoint: 'transfer_blobs' as const,
                planned: { totalBytes: 100 },
                transferred: { bytes: transferredBytes },
                resumable: true,
            },
            recoveryActions: [],
        });

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={createStatus(25, 1)}
            />,
        );

        const progressBar = screen.findByTestId('session-handoff-progress-bar');
        expect(progressBar?.props.accessibilityRole).toBe('progressbar');
        expect(progressBar?.props.accessibilityLabel).toBe('sessionHandoff.progress.primary.moving');
        expect(progressBar?.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 25 });

        const initialStatus = screen.findByTestId('session-handoff-progress-status');
        expect(initialStatus?.props.accessibilityLiveRegion).toBe('polite');
        expect(initialStatus?.props.role).toBe('status');
        expect(initialStatus?.props.accessibilityLabel).toContain('25%');

        await screen.update(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={createStatus(50, 2)}
            />,
        );

        expect(screen.findByTestId('session-handoff-progress-bar')?.props.accessibilityValue)
            .toEqual({ min: 0, max: 100, now: 50 });
        expect(screen.findByTestId('session-handoff-progress-status')?.props.accessibilityLabel)
            .toContain('50%');
    });

    it('renders apply progress counts without a transfer progress bar during application', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_apply_progress_1',
                    status: 'pending',
                    phase: 'finalizing',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'apply',
                        planned: {
                            totalFiles: 4,
                            totalBytes: 4096,
                        },
                        transferred: {
                            files: 4,
                            bytes: 4096,
                            blobs: 2,
                        },
                        applied: {
                            files: 2,
                            bytes: 2048,
                        },
                        remaining: {
                            files: 0,
                            bytes: 0,
                        },
                        current: {
                            phaseDetail: 'applying_workspace',
                        },
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-stats')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-stat-applied')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-bar')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-percent')).toBeNull();
        expect(screen.getTextContent()).toContain('common.applied');
        expect(screen.getTextContent()).toContain('sessionHandoff.progress.remaining');
    });

    it('does not shrink the timeline back to minimal after the daemon has already emitted a full-timeline checkpoint', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const renderProps = {
            onClose: () => {},
        };

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                {...renderProps}
                status={{
                    handoffId: 'handoff_timeline_latch_1',
                    status: 'pending',
                    phase: 'preparing',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'plan',
                        planned: {},
                        transferred: {},
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-checkpoint-plan')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-scan_source')).toBeNull();

        act(() => {
            screen.tree.update(
                <SessionHandoffProgressModal
                    {...renderProps}
                    status={{
                        handoffId: 'handoff_timeline_latch_1',
                        status: 'pending',
                        phase: 'finalizing',
                        progress: {
                            updatedAtMs: 456,
                            checkpoint: 'import_session',
                            planned: {},
                            transferred: {},
                            resumable: true,
                        },
                        recoveryActions: [],
                    }}
                />,
            );
        });

        expect(screen.findByTestId('session-handoff-progress-checkpoint-plan')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-scan_source')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-import_session')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-finalize')).toBeTruthy();
    });

    it('keeps the checkpoint timeline minimal when the daemon reports only minimal checkpoints (even with workspace progress)', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_minimal_with_workspace_progress_1',
                    status: 'pending',
                    phase: 'staging_target',
                    workspacePreflightSummary: {
                        addedPathsCount: 1,
                        changedPathsCount: 0,
                        removedPathsCount: 0,
                        totalBytes: 1024,
                    },
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'import_session',
                        planned: {
                            totalFiles: 1,
                            totalBytes: 1024,
                        },
                        transferred: {
                            bytes: 128,
                        },
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-checkpoint-stage_target')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-import_session')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-finalize')).toBeTruthy();

        expect(screen.findByTestId('session-handoff-progress-checkpoint-scan_source')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-plan')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-apply')).toBeNull();
    });

    it('shows a failure presentation without a spinner when the handoff status is failed', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                setChrome={setChrome}
                status={{
                    handoffId: 'handoff_failed_1',
                    status: 'failed',
                    phase: 'transferring',
                    recoveryActions: [],
                }}
            />,
        );

        expect(setChrome).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'card',
                title: 'sessionHandoff.failure.title',
            }),
        );
        expect(screen.getTextContent()).toContain('sessionHandoff.failure.message');
        expect(findProgressIndicators(screen)).toHaveLength(0);
    });

    it('surfaces the phase detail when the handoff is awaiting recovery', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                setChrome={setChrome}
                status={{
                    handoffId: 'handoff_recovery_1',
                    status: 'awaiting_recovery',
                    phase: 'resuming',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'transfer_blobs',
                        planned: {
                            totalBytes: 1024,
                        },
                        transferred: {
                            bytes: 1024,
                        },
                        current: {
                            phaseDetail: 'daemon_restart_detected',
                        },
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        expect(setChrome).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'card',
                title: 'sessionHandoff.recovery.title',
            }),
        );
        await expandProgressDetails(screen);
        expect(screen.getTextContent()).toContain('sessionHandoff.recovery.messageAfterSourceStop');
        expect(screen.getTextContent()).toContain('daemon_restart_detected');
        expect(screen.findByTestId('session-handoff-progress-bar')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-percent')).toBeNull();
        expect(findProgressIndicators(screen)).toHaveLength(0);
    });

    it('does not render a percent/progress bar when the checkpoint is import_session (even if byte counters are present)', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_import_session_1',
                    status: 'pending',
                    phase: 'staging_target',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'import_session',
                        planned: {
                            totalBytes: 1024,
                        },
                        transferred: {
                            bytes: 1024,
                        },
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-percent')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-bar')).toBeNull();
        expect(screen.getTextContent()).toContain('sessionHandoff.progress.timeline.importSession');
    });

    it('renders the current checkpoint label when no current path and no progress fraction are available', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_3',
                    status: 'pending',
                    phase: 'staging_target',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'stage_target',
                        planned: {},
                        transferred: {},
                        current: {
                            phaseDetail: 'preparing_target',
                        },
                        resumable: false,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-timeline')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-path')).toBeTruthy();
        expect(screen.getTextContent()).toContain('sessionHandoff.progress.timeline.stageTarget');
    });

    it('renders a minimal checkpoint timeline when workspace transfer is not in play', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_minimal_1',
                    status: 'pending',
                    phase: 'staging_target',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'stage_target',
                        planned: {},
                        transferred: {},
                        resumable: false,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-checkpoint-stage_target')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-import_session')).toBeTruthy();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-finalize')).toBeTruthy();

        expect(screen.findByTestId('session-handoff-progress-checkpoint-scan_source')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-plan')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-apply')).toBeNull();
    });

    it('keeps the daemon-emitted checkpoint selected when the handoff status is completed', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_4',
                    status: 'completed',
                    phase: 'finalizing',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'import_session',
                        planned: {},
                        transferred: {},
                        resumable: false,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        const currentCheckpointRow = screen.findByTestId('session-handoff-progress-checkpoint-import_session');
        expect(currentCheckpointRow?.props.accessibilityState?.selected).toBe(true);
        expect(screen.findByTestId('session-handoff-progress-checkpoint-finalize')?.props.accessibilityState?.selected).toBe(false);
    });

    it('ignores stale progress updates (by updatedAtMs) so the checkpoint selection never regresses', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const renderProps = {
            onClose: () => {},
        };

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                {...renderProps}
                status={{
                    handoffId: 'handoff_out_of_order_1',
                    status: 'in_progress',
                    phase: 'transferring',
                    progress: {
                        updatedAtMs: 200,
                        checkpoint: 'transfer_blobs',
                        planned: {},
                        transferred: {},
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs')?.props.accessibilityState?.selected).toBe(true);

        act(() => {
            screen.tree.update(
                <SessionHandoffProgressModal
                    {...renderProps}
                    status={{
                        handoffId: 'handoff_out_of_order_1',
                        status: 'in_progress',
                        phase: 'staging_target',
                        progress: {
                            updatedAtMs: 100,
                            checkpoint: 'plan',
                            planned: {},
                            transferred: {},
                            resumable: true,
                        },
                        recoveryActions: [],
                    }}
                />,
            );
        });

        expect(screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs')?.props.accessibilityState?.selected).toBe(true);
        expect(screen.findByTestId('session-handoff-progress-checkpoint-plan')?.props.accessibilityState?.selected).toBe(false);
    });

    it('keeps the last daemon checkpoint visible when a terminal status update arrives without progress', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');
        const setChrome = vi.fn();

        const renderProps = {
            onClose: () => {},
            setChrome,
        };

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                {...renderProps}
                status={{
                    handoffId: 'handoff_terminal_without_progress_1',
                    status: 'in_progress',
                    phase: 'transferring',
                    progress: {
                        updatedAtMs: 200,
                        checkpoint: 'transfer_blobs',
                        planned: {},
                        transferred: {},
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs')?.props.accessibilityState?.selected).toBe(true);

        act(() => {
            screen.tree.update(
                <SessionHandoffProgressModal
                    {...renderProps}
                    status={{
                        handoffId: 'handoff_terminal_without_progress_1',
                        status: 'aborted',
                        phase: 'finalizing',
                        recoveryActions: [],
                    }}
                />,
            );
        });

        expect(setChrome).toHaveBeenLastCalledWith(
            expect.objectContaining({
                kind: 'card',
                title: 'sessionHandoff.failure.title',
            }),
        );
        expect(screen.getTextContent()).toContain('sessionHandoff.failure.message');
        expect(screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs')?.props.accessibilityState?.selected).toBe(true);
    });

    it('anchors ready_for_cutover to the daemon-reported checkpoint (import_session)', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_ready_for_cutover_1',
                    status: 'ready_for_cutover',
                    phase: 'cutover',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'import_session',
                        planned: {},
                        transferred: {},
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-bar')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-percent')).toBeNull();
        expect(screen.findByTestId('session-handoff-progress-checkpoint-stage_target')).toBeTruthy();
        const importSessionRow = screen.findByTestId('session-handoff-progress-checkpoint-import_session');
        expect(importSessionRow?.props.accessibilityState?.selected).toBe(true);
        expect(screen.findByTestId('session-handoff-progress-checkpoint-transfer_blobs')).toBeNull();
    });

    it('does not render summary chips when workspace preflight summary is missing', async () => {
        const { SessionHandoffProgressModal } = await import('./SessionHandoffProgressModal');

        const screen = await renderScreen(
            <SessionHandoffProgressModal
                onClose={() => {}}
                status={{
                    handoffId: 'handoff_2',
                    status: 'in_progress',
                    phase: 'transferring',
                    progress: {
                        updatedAtMs: 123,
                        checkpoint: 'transfer_blobs',
                        planned: {
                            added: 2,
                            changed: 1,
                            removed: 3,
                            totalBytes: 2048,
                        },
                        transferred: {
                            bytes: 0,
                        },
                        resumable: true,
                    },
                    recoveryActions: [],
                }}
            />,
        );

        await expandProgressDetails(screen);
        expect(screen.findByTestId('session-handoff-progress-summary')).toBeNull();
        const textContent = screen.getTextContent();
        expect(textContent).not.toContain('+2');
        expect(textContent).not.toContain('~1');
        expect(textContent).not.toContain('-3');
    });

});
