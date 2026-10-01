import type { InboxWorkItem } from '@/activity/presentation/buildInboxWorkGroups';

/**
 * The Inbox route's one focus parameter (`/inbox?item=session:<id>` or `run:<id>`): the needs-you item
 * a person came to see from elsewhere (a Boards card, INT §5.1). The Inbox view opens on Needs you
 * with that item's row selected. A Session id or a workflow run id names its item on its own, so the
 * parameter carries no Home.
 */
export type InboxItemFocus = Readonly<{ kind: 'session' | 'workflow_run'; id: string }>;

const PREFIX: Readonly<Record<InboxItemFocus['kind'], string>> = { session: 'session:', workflow_run: 'run:' };

export function createInboxItemRoute(focus: InboxItemFocus) {
    return { pathname: '/inbox', params: { item: `${PREFIX[focus.kind]}${focus.id}` } } as const;
}

export function readInboxItemFocus(raw: string | string[] | undefined): InboxItemFocus | null {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;
    for (const kind of ['session', 'workflow_run'] as const) {
        const id = value.startsWith(PREFIX[kind]) ? value.slice(PREFIX[kind].length).trim() : '';
        if (id) return { kind, id };
    }
    return null;
}

/** Whether a needs-you row is the focused item: a Session's row in any of its forms, or the run's own row. */
export function isFocusedInboxWorkItem(item: InboxWorkItem, focus: InboxItemFocus | null): boolean {
    if (!focus) return false;
    switch (item.kind) {
        case 'session':
            return focus.kind === 'session' && item.entry.candidate.sessionId === focus.id;
        case 'workflow_run':
            return focus.kind === 'workflow_run' && item.runId === focus.id;
        case 'stalled':
        case 'landing':
        case 'snoozed':
            return focus.kind === 'session' && item.session.id === focus.id;
    }
}
