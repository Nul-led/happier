import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

import type { WorkflowAnnouncementState } from './workflowAnnouncementSelection';

/**
 * What arriving at a workflow surface announces.
 *
 * The comparison baseline used to be the empty state, which nobody was ever
 * shown — so simply opening a screen announced its blocks as newly inserted, or
 * an already-finished Run as having just finished. Only what changes after the
 * first observed state is a transition.
 */

const announcements = vi.hoisted(() => ({ messages: [] as string[] }));

vi.mock('@/components/ui/accessibility/announceAccessibilityMessage', () => ({
    announceAccessibilityMessage: (message: string) => { announcements.messages.push(message); },
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

afterEach(async () => {
    announcements.messages.length = 0;
    await standardCleanup();
});

function state(overrides: Partial<WorkflowAnnouncementState> = {}): WorkflowAnnouncementState {
    return {
        blockIds: [],
        selectedBlockId: null,
        blockingIssue: null,
        attentionCount: 0,
        terminal: null,
        changedRowCount: 0,
        selectedRowChanged: false,
        ...overrides,
    } as WorkflowAnnouncementState;
}

async function renderAnnouncements(initial: WorkflowAnnouncementState, enabled = true) {
    const { useWorkflowAnnouncements } = await import('./useWorkflowAnnouncements');
    return renderHook(
        (props: Readonly<{ state: WorkflowAnnouncementState; enabled: boolean }>) => useWorkflowAnnouncements({
            state: props.state,
            enabled: props.enabled,
            resolveBlockLabel: (blockId) => blockId,
        }),
        { initialProps: { state: initial, enabled } },
    );
}

describe('useWorkflowAnnouncements', () => {
    it('says nothing about the state it arrives at', async () => {
        // Three blocks and a finished Run are what this surface *is*, not
        // something that just happened while the reader was listening.
        await renderAnnouncements(state({
            blockIds: ['analyze', 'implement', 'review'],
            terminal: 'succeeded',
            attentionCount: 2,
        }));

        expect(announcements.messages).toEqual([]);
    });

    it('announces the first committed change after that', async () => {
        const hook = await renderAnnouncements(state({ blockIds: ['analyze'] }));
        expect(announcements.messages).toEqual([]);

        await hook.rerender({
            state: state({ blockIds: ['analyze', 'implement'] }),
            enabled: true,
        });

        expect(announcements.messages).toHaveLength(1);
    });

    it('keeps a delayed surface baselined on what it was already showing', async () => {
        // The Run screen enables announcements only once its invocation window
        // has loaded. Enabling must not replay everything observed while quiet.
        const hook = await renderAnnouncements(state({ blockIds: ['analyze'] }), false);
        await hook.rerender({
            state: state({ blockIds: ['analyze', 'implement'], attentionCount: 3 }),
            enabled: false,
        });
        expect(announcements.messages).toEqual([]);

        await hook.rerender({
            state: state({ blockIds: ['analyze', 'implement'], attentionCount: 3 }),
            enabled: true,
        });
        expect(announcements.messages).toEqual([]);
    });
});
