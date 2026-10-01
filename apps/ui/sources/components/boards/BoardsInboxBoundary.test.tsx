import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkBoardV1, type WorkBoardV1 } from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Counts Inbox model instances: each boundary is one full Inbox model (a workflow-attention source and
// its run-list read). Same counting seam as `InboxPopover.test.tsx`.
const boundaries = vi.hoisted(() => ({ mounts: 0 }));
vi.mock('@/hooks/inbox/useInboxModel', () => ({
    InboxModelBoundary: (props: { children: React.ReactNode }) => {
        boundaries.mounts += 1;
        return props.children;
    },
}));

const { BoardsInboxBoundary } = await import('./BoardsInboxBoundary');

function pinned(id: string, sections?: WorkBoardV1['source']['sections']): WorkBoardV1 {
    return { ...createWorkBoardV1({ id, name: id }), source: { ...(sections ? { sections } : {}), picked: [] }, pinnedInSessions: true };
}

describe('BoardsInboxBoundary (INT §7.3, three pinned boards)', () => {
    it('mounts one Inbox model for the pinned rows, and none when no pinned board shows Needs you', async () => {
        boundaries.mounts = 0;
        const rows = (count: number) => Array.from({ length: count }, (_, index) => <React.Fragment key={index}>row</React.Fragment>);
        await renderScreen(
            <BoardsInboxBoundary boards={[pinned('a', ['needs_you']), pinned('b', ['needs_you', 'running']), pinned('c', ['running'])]}>
                {rows(3)}
            </BoardsInboxBoundary>,
        );
        // Before: one boundary per pinned row, so three models for three boards.
        expect(boundaries.mounts).toBe(1);

        boundaries.mounts = 0;
        await renderScreen(
            <BoardsInboxBoundary boards={[pinned('a', ['running']), pinned('b'), pinned('c', ['my_machines'])]}>
                {rows(3)}
            </BoardsInboxBoundary>,
        );
        expect(boundaries.mounts).toBe(0);
    });
});
