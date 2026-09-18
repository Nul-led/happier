import type { AgentActivityStatusV1 } from '@happier-dev/protocol';

import type { IconName } from '@/components/ui/icons/Icon';
import type { StatusPillVariant } from '@/components/ui/status/StatusPill';
import type {
    AgentActivityEntry,
    AgentActivityEntryKind,
    SessionAgentActivityAttentionKind,
} from '@/sync/domains/session/agentActivity';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';
import { t } from '@/text';

import { resolveSessionSubagentKindLabelKey } from './resolveSessionSubagentKindLabelKey';
import { resolveSessionSubagentPrimaryTitle } from './resolveSessionSubagentPrimaryTitle';

/**
 * Everything a surface needs to draw one unit of Session agent work — resolved once, for everyone.
 *
 * Before this module the roster row, the Details overview card and the Agents panel each resolved
 * their own title, their own subtitle, their own status colour and their own attention badge from
 * overlapping inputs. They disagreed: the row painted the RAW status token (`timedOut`) with a
 * hand-rolled accent, the card painted the raw token in grey, and neither could say that an agent
 * had asked a QUESTION rather than requested an approval.
 *
 * The rule this module enforces is that presentation reads the MERGED `AgentActivityEntry` — the
 * canonical status and attention — and uses the local `SessionSubagent` only for detail the entry
 * genuinely does not carry (the live title, the provider label, the run id). A host that still had
 * a subagent in hand and rendered `subagent.status` would silently disagree with the roster the
 * moment the publisher reported a terminal outcome first.
 *
 * It is a pure function, not a component and not a hook, so a conversation timeline, a roster and a
 * Details panel can each compose the result into their own legitimate geometry without inheriting a
 * card's chrome or growing `compact`/`showActions` booleans on one monolith.
 */

export type SessionAgentActivityAttentionPresentation = Readonly<{
    /** One short phrase for the badge — never two badges stacked in a dense row. */
    label: string;
    variant: StatusPillVariant;
    /** Spoken form, which names every pending kind even when the badge condenses them. */
    description: string;
}>;

export type SessionAgentActivityPresentation = Readonly<{
    title: string;
    /**
     * Secondary facts in canonical order, deduplicated, for the one line under the title.
     *
     * Ordered least- to most-specific (what kind of work, who runs it, which team, what it is
     * about, which run), so truncation drops identifiers before it drops meaning.
     */
    facts: readonly string[];
    statusLabel: string;
    statusVariant: StatusPillVariant;
    /** Present only while a person is the blocker. */
    attention: SessionAgentActivityAttentionPresentation | null;
    iconName: IconName;
    /** The theme accent name for the leading icon, when a local source supplied one. */
    accentName: string | null;
    /** The whole summary as one spoken string, so a row announces itself in one utterance. */
    accessibilityLabel: string;
}>;

const STATUS_LABEL_KEYS = {
    queued: 'sessionAgentActivity.status.queued',
    starting: 'sessionAgentActivity.status.starting',
    running: 'sessionAgentActivity.status.running',
    waiting: 'sessionAgentActivity.status.waiting',
    blocked: 'sessionAgentActivity.status.blocked',
    succeeded: 'sessionAgentActivity.status.succeeded',
    failed: 'sessionAgentActivity.status.failed',
    timedOut: 'sessionAgentActivity.status.timedOut',
    cancelled: 'sessionAgentActivity.status.cancelled',
    unknown: 'sessionAgentActivity.status.unknown',
} as const satisfies Record<AgentActivityStatusV1, string>;

/**
 * How a status is coloured, exhaustively.
 *
 * `timedOut` and `cancelled` share `warning` with `waiting` and `blocked` because all four are
 * interrupted rather than wrong: `danger` is reserved for `failed`, where there is an error to read.
 * A new status member fails to compile here instead of defaulting to a colour that would lie.
 */
const STATUS_VARIANTS = {
    queued: 'neutral',
    starting: 'neutral',
    running: 'info',
    waiting: 'warning',
    blocked: 'warning',
    succeeded: 'success',
    failed: 'danger',
    timedOut: 'warning',
    cancelled: 'warning',
    unknown: 'neutral',
} as const satisfies Record<AgentActivityStatusV1, StatusPillVariant>;

const KIND_ICON_NAMES = {
    execution_run: 'play-circle',
    agent_team_member: 'users',
    subagent: 'stack-simple',
    workflow_run: 'stack-simple',
    workflow_agent: 'stack-simple',
} as const satisfies Record<AgentActivityEntryKind, IconName>;

function resolveAttention(
    attentionKinds: readonly SessionAgentActivityAttentionKind[],
): SessionAgentActivityAttentionPresentation | null {
    const wantsApproval = attentionKinds.includes('permission');
    const wantsAnswer = attentionKinds.includes('user_action');

    if (wantsApproval && wantsAnswer) {
        // One badge, both facts. A row that stacked two badges would push the title into a second
        // line exactly when the row most needs to be legible at a glance.
        return {
            label: t('sessionAgentActivity.attention.both'),
            variant: 'warning',
            description: t('sessionAgentActivity.attention.bothDescription'),
        };
    }
    if (wantsApproval) {
        const label = t('sessionAgentActivity.attention.permission');
        return { label, variant: 'warning', description: label };
    }
    if (wantsAnswer) {
        const label = t('sessionAgentActivity.attention.userAction');
        return { label, variant: 'warning', description: label };
    }
    return null;
}

function resolveTitle(entry: AgentActivityEntry, subagent: SessionSubagent | null): string {
    // The local title is the live one and knows not to show a run id as a name; the entry title is
    // what the publisher sent, which is all an unloaded row has.
    const localTitle = subagent ? resolveSessionSubagentPrimaryTitle(subagent).trim() : '';
    if (localTitle.length > 0) return localTitle;
    const entryTitle = entry.title.trim();
    return entryTitle.length > 0 ? entryTitle : entry.id;
}

function resolveFacts(entry: AgentActivityEntry, subagent: SessionSubagent | null): readonly string[] {
    const teamLabel = subagent?.kind === 'agent_team_member'
        ? subagent.display.groupLabel?.trim()
            || subagent.display.groupKey?.trim()
            || (subagent.recipient?.kind === 'agent_team_member' ? subagent.recipient.teamId.trim() : null)
        : null;

    const candidates = [
        subagent ? t(resolveSessionSubagentKindLabelKey(subagent.kind)) : null,
        subagent?.display.providerLabel?.trim() || subagent?.runRef?.backendId?.trim() || null,
        teamLabel,
        subagent?.display.subtitle?.trim() ?? entry.metaDetail?.trim() ?? null,
        entry.runId?.trim() ?? null,
    ];

    const facts: string[] = [];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const value = candidate.trim();
        // Deduplicated because the same string legitimately reaches two slots — a subtitle that is
        // just the provider name, a title that is the run id — and repeating it reads as a bug.
        if (value.length === 0 || facts.includes(value)) continue;
        facts.push(value);
    }
    return facts;
}

export function resolveSessionAgentActivityPresentation(params: Readonly<{
    entry: AgentActivityEntry;
    /** The locally derived row behind the entry, when this host loaded one. */
    subagent?: SessionSubagent | null;
}>): SessionAgentActivityPresentation {
    const { entry } = params;
    const subagent = params.subagent ?? null;
    const title = resolveTitle(entry, subagent);
    const statusLabel = t(STATUS_LABEL_KEYS[entry.status]);
    const attention = resolveAttention(entry.attentionKinds);

    return {
        title,
        facts: resolveFacts(entry, subagent),
        statusLabel,
        statusVariant: STATUS_VARIANTS[entry.status],
        attention,
        iconName: KIND_ICON_NAMES[entry.kind],
        accentName: subagent?.display.accentName?.trim() || null,
        accessibilityLabel: attention
            ? t('sessionAgentActivity.summaryAttentionA11y', {
                title,
                status: statusLabel,
                attention: attention.description,
            })
            : t('sessionAgentActivity.summaryA11y', { title, status: statusLabel }),
    };
}
