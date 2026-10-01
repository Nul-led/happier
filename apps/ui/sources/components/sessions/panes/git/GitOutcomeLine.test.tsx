import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    });
});

const FACTS = { ahead: 3, behind: 0, selectedCount: 2, upstream: 'origin/v0.3' } as const;
const { GitOutcomeLine } = await import('./GitOutcomeLine');

async function render(props: Partial<React.ComponentProps<typeof import('./GitOutcomeLine').GitOutcomeLine>>) {
    let setProps!: React.Dispatch<React.SetStateAction<typeof props>>;
    function Controller() {
        const [current, update] = React.useState(props);
        setProps = update;
        return (
            <GitOutcomeLine
                operation={null}
                facts={FACTS}
                machineName="MacBook Pro"
                machineReachable={true}
                recovery={{}}
                haptics={false}
                {...current}
            />
        );
    }
    const screen = await renderScreen(<Controller />);
    return Object.assign(screen, { setProps });
}

function allText(screen: Awaited<ReturnType<typeof render>>): string {
    return screen.getTextContent();
}

describe('GitOutcomeLine (Git lab C/S/SX)', () => {
    afterEach(() => vi.useRealTimers());

    it('says how much a landed push moved, from the facts captured when it started, then fades after 6 s', async () => {
        vi.useFakeTimers();
        const screen = await render({ operation: { phase: 'running', action: 'push', id: 'p1', at: 1 } });
        // Push progress lives in the header button, not in a second line.
        expect(screen.root.findAll((node) => node.props.testID === 'session-git-outcome-running')).toHaveLength(0);

        // The branch has caught up by the time the result lands; the line still says 3 commits moved.
        await act(async () => {
            screen.setProps({ operation: { phase: 'succeeded', action: 'push', id: 'p1', at: 2, message: '', outcome: { v: 1, kind: 'succeeded', nextActions: [] } }, facts: { ...FACTS, ahead: 0 } });
        });
        expect(allText(screen)).toContain('sessionGitPane.flow.done.pushCommits');
        expect(allText(screen)).toContain('"count":3');

        await act(async () => { vi.advanceTimersByTime(6_100); });
        expect(screen.root.findAll((node) => node.props.testID === 'session-git-outcome-succeeded')).toHaveLength(0);
    });

    it('names a rejected push and offers Fetch as its one recovery, and can be put away', async () => {
        const fetch = vi.fn();
        const screen = await render({
            operation: { phase: 'needs_input', action: 'push', id: 'r1', at: 1, message: '', outcome: { v: 1, kind: 'needs_input', errorCode: 'REMOTE_NON_FAST_FORWARD', nextActions: [{ kind: 'choose_reconcile' }] } },
            recovery: { fetch },
        });
        expect(allText(screen)).toContain('sessionGitPane.flow.failed.rejectedTitle');
        await screen.pressByTestIdAsync('session-git-outcome-needs_input.action');
        expect(fetch).toHaveBeenCalledTimes(1);

        await screen.pressByTestIdAsync('session-git-outcome-needs_input.dismiss');
        expect(screen.findAllHostsByTestId('session-git-outcome-needs_input')).toHaveLength(0);
    });

    it('shows progress for a write without its own control (a branch switch)', async () => {
        const screen = await render({ operation: { phase: 'running', action: 'branch_switch', id: 'b1', at: 1 } });
        expect(allText(screen)).toContain('sessionGitPane.flow.running.branchSwitch');
    });

    it('lets a dirty pull choose whether to keep changes aside or let Git check overlap', async () => {
        const pullWith = vi.fn();
        const screen = await render({
            operation: { phase: 'needs_input', action: 'pull', id: 'dirty', at: 1, message: '', outcome: { v: 1, kind: 'needs_input', errorCode: 'COMMIT_REQUIRED', nextActions: [{ kind: 'choose_dirty_policy' }] } },
            facts: { ...FACTS, changedCount: 2 },
            recovery: { pullWith },
        });

        expect(allText(screen)).toContain('sessionGitPane.flow.choices.dirtyTitle');
        await screen.pressByTestIdAsync('session-git-outcome-needs_input.action');
        await screen.pressByTestIdAsync('session-git-outcome-needs_input.secondaryAction');
        expect(pullWith.mock.calls).toEqual([[{ dirtyPolicy: 'autostash' }], [{ dirtyPolicy: 'allow_git' }]]);
    });

    it('offers merge first on a default branch without silently fetching or retrying a diverged pull', async () => {
        const pullWith = vi.fn();
        const fetch = vi.fn();
        const retry = vi.fn();
        const screen = await render({
            operation: { phase: 'needs_input', action: 'pull', id: 'diverged', at: 1, message: '', outcome: { v: 1, kind: 'needs_input', errorCode: 'REMOTE_FF_ONLY_REQUIRED', nextActions: [{ kind: 'choose_reconcile' }] } },
            recovery: { pullWith, preferRebase: false, fetch, retry },
        });

        await screen.pressByTestIdAsync('session-git-outcome-needs_input.action');
        await screen.pressByTestIdAsync('session-git-outcome-needs_input.secondaryAction');
        expect(pullWith.mock.calls).toEqual([[{ reconcile: 'merge' }], [{ reconcile: 'rebase' }]]);
        expect(fetch).not.toHaveBeenCalled();
        expect(retry).not.toHaveBeenCalled();
    });

    it('offers a reachability refresh instead of repeating a write while the machine is offline', async () => {
        const refresh = vi.fn();
        const retry = vi.fn();
        const screen = await render({
            operation: { phase: 'failed', action: 'push', id: 'offline', at: 1, message: '', outcome: { v: 1, kind: 'failed', errorCode: 'REMOTE_NETWORK_FAILED', nextActions: [{ kind: 'retry' }] } },
            machineReachable: false,
            recovery: { refresh, retry },
        });

        expect(allText(screen)).toContain('sessionGitPane.flow.failed.offlineTitle');
        await screen.pressByTestIdAsync('session-git-outcome-failed.action');
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(retry).not.toHaveBeenCalled();
    });

    it('keeps an unknown outward result visible and reconciles without repeating the write', async () => {
        const retry = vi.fn();
        const refresh = vi.fn();
        const screen = await render({
            operation: { phase: 'outcome_unknown', action: 'push', id: 'u', at: 1, message: 'Read the remote before trying again', outcome: { v: 1, kind: 'outcome_unknown', errorCode: 'COMMAND_OUTCOME_UNKNOWN', reconciliation: { kind: 'remote_ref', remote: 'origin', branch: 'v0.3' }, nextActions: [{ kind: 'refresh' }] } },
            recovery: { retry, refresh },
        });
        expect(allText(screen)).toContain('sessionGitPane.flow.failed.unknownTitle');
        expect(allText(screen)).toContain('sessionGitPane.flow.failed.unknownBody');
        await screen.pressByTestIdAsync('session-git-outcome-outcome_unknown.action');
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(retry).not.toHaveBeenCalled();
    });
});
