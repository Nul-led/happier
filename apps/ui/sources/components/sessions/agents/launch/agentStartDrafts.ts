import type {
    DetailsTabState,
    DetailsWorkspaceGroupView,
} from '@/components/appShell/panes/details/workspace/detailsWorkspaceTypes';
import {
    resolveExecutionRunLauncherIntent,
    type ExecutionRunIntent,
} from '@/components/sessions/runs/launcher/executionRunLauncherModel';

/** A start that is open beside the Session and has not been sent yet (lab `convo-S1` Start row). */
export type AgentStartDraft = Readonly<{
    tabKey: string;
    /** `null` for a plain conversation. */
    intent: ExecutionRunIntent | null;
    /** The tab the person is looking at. */
    active: boolean;
}>;

const NO_DRAFTS: readonly AgentStartDraft[] = Object.freeze([]);

function readDraftIntent(resource: unknown): ExecutionRunIntent | null | undefined {
    if (!resource || typeof resource !== 'object') return undefined;
    const value = resource as { kind?: unknown; mode?: unknown; intent?: unknown };
    if (value.kind !== 'executionRunLauncher') return undefined;
    if (value.mode === 'conversation') return null;
    // The intent-less launcher tab is "Advanced": a review with every choice.
    return value.intent === undefined ? 'review' : resolveExecutionRunLauncherIntent(value.intent) ?? undefined;
}

/**
 * The unsent starts open in this Session's Details workspace, read from the pane state that owns
 * them — never a second draft registry. A draft stops being listed the moment its first Send turns
 * the tab into its Run.
 */
export function projectAgentStartDrafts(details: Readonly<{
    isOpen: boolean;
    tabs: ReadonlyArray<DetailsTabState>;
    activeTabKey: string | null;
    /** Split groups, when the workspace has them; one implicit group otherwise. */
    groups?: ReadonlyArray<Pick<DetailsWorkspaceGroupView, 'activeTabKey' | 'tabs'>>;
}> | null | undefined): readonly AgentStartDraft[] {
    if (!details) return NO_DRAFTS;
    const drafts: AgentStartDraft[] = [];
    const seen = new Set<string>();
    const groups = details.groups ?? [{ activeTabKey: details.activeTabKey, tabs: details.tabs }];
    for (const group of groups) {
        for (const tab of group.tabs) {
            if (seen.has(tab.key)) continue;
            const intent = readDraftIntent(tab.resource);
            if (intent === undefined) continue;
            seen.add(tab.key);
            drafts.push({
                tabKey: tab.key,
                intent,
                active: details.isOpen && group.activeTabKey === tab.key,
            });
        }
    }
    return drafts.length > 0 ? drafts : NO_DRAFTS;
}
