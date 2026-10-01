import type { DetailsTab } from '@/components/appShell/panes/model/appPaneReducer';

export const SESSION_PEEK_DETAILS_TAB_KIND = 'sessionPeek';

export type SessionPeekDetailsResource = Readonly<{ kind: typeof SESSION_PEEK_DETAILS_TAB_KIND; sessionId: string }>;

/** The peek of a Session the lead leads (ORC §3.8, lab `session-D`): one Details tab per Session. */
export function createSessionPeekDetailsTab(params: Readonly<{
    sessionId: string;
    title: string;
    subtitle?: string | null;
}>): DetailsTab {
    return {
        key: `${SESSION_PEEK_DETAILS_TAB_KIND}:${params.sessionId}`,
        kind: SESSION_PEEK_DETAILS_TAB_KIND,
        title: params.title,
        subtitle: params.subtitle ?? null,
        resource: { kind: SESSION_PEEK_DETAILS_TAB_KIND, sessionId: params.sessionId } satisfies SessionPeekDetailsResource,
    };
}

export function isSessionPeekDetailsResource(value: unknown): value is SessionPeekDetailsResource {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as { kind?: unknown; sessionId?: unknown };
    return candidate.kind === SESSION_PEEK_DETAILS_TAB_KIND
        && typeof candidate.sessionId === 'string'
        && candidate.sessionId.trim().length > 0;
}
