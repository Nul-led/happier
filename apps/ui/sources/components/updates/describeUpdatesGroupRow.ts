import { t } from '@/text';
import { planUpdateAll } from '@/updates/items/buildUpdatesSummary';
import type { UpdateItem } from '@/updates/items/updateItem';
import type { UpdatesGroup } from '@/updates/useUpdatesContentModel';
import { formatLastSeen as formatLastSeenDefault } from '@/utils/sessions/sessionUtils';

import { describeUpdateItem } from './describeUpdateItem';

/** How the row's status line is marked: a dot, or a warning glyph for `attention`. */
export type UpdatesGroupRowTone = 'ok' | 'info' | 'pending' | 'attention' | 'off' | 'neutral';

export type UpdatesGroupRowAction =
    /** Exactly one thing on the machine can be run: run that item (its own verb: Update, Retry, Restart…). */
    | Readonly<{ kind: 'item'; item: UpdateItem; label: string }>
    /** Several updates wait on the machine: update them all, in the owner's per-machine order. */
    | Readonly<{ kind: 'group'; label: string }>;

export type UpdatesGroupRow = Readonly<{
    title: string;
    status: string;
    tone: UpdatesGroupRowTone;
    action: UpdatesGroupRowAction | null;
}>;

function groupTitle(group: UpdatesGroup): string {
    if (group.kind === 'app') return t('updates.sections.thisApp');
    if (group.machineName) return group.machineName;
    return group.kind === 'thisComputer' ? t('updates.sections.thisComputer') : t('updates.sections.machine');
}

/** "Codex · 0.2.12 → 0.2.14": the one item's own words, named, when it is the only thing to say. */
function namedItemStatus(item: UpdateItem): string {
    return `${item.title} · ${describeUpdateItem(item).subtitle}`;
}

function runnableAction(item: UpdateItem): UpdatesGroupRowAction | null {
    const label = describeUpdateItem(item).actionLabel;
    return label && item.action.kind === 'run' ? { kind: 'item', item, label } : null;
}

/**
 * The Updates popover's one row per machine (and one for this app): its name, one status line and
 * at most one action. Every fact is the updates owner's (`UpdatesGroup`, `describeUpdateItem`,
 * `planUpdateAll`); this only chooses what one line says. Precedence follows what the person can do
 * next: offline (nothing), in flight (wait), failed (retry), waiting updates (update), ready
 * (restart), then quiet states.
 */
export function describeUpdatesGroupRow(
    group: UpdatesGroup,
    options: Readonly<{ formatLastSeen?: (at: number) => string }> = {},
): UpdatesGroupRow {
    const title = groupTitle(group);
    const formatLastSeen = options.formatLastSeen ?? ((at: number) => formatLastSeenDefault(at));

    if (!group.online) {
        const status = group.lastSeenAt != null
            ? `${t('updates.offline')} · ${t('status.lastSeen', { time: formatLastSeen(group.lastSeenAt) })}`
            : t('updates.offline');
        return { title, status, tone: 'off', action: null };
    }

    const running = group.items.filter((item) => item.state === 'running');
    if (running.length > 0) {
        return {
            title,
            status: running.length === 1 ? namedItemStatus(running[0]!) : t('updates.summary.updating'),
            tone: 'pending',
            action: null,
        };
    }

    const failed = group.items.filter((item) => item.state === 'failed');
    if (failed.length > 0) {
        return {
            title,
            status: failed.length === 1 ? namedItemStatus(failed[0]!) : t('updates.summary.failedCount', { count: failed.length }),
            tone: 'attention',
            action: failed.length === 1 ? runnableAction(failed[0]!) : null,
        };
    }

    const plan = planUpdateAll(group.items);
    if (plan.total > 0) {
        const waiting = group.items.filter((item) => plan.appItemId === item.id || plan.machines.some((machine) => machine.itemIds.includes(item.id)));
        const required = waiting.some((item) => item.state === 'required');
        if (waiting.length === 1) {
            return { title, status: namedItemStatus(waiting[0]!), tone: required ? 'attention' : 'info', action: runnableAction(waiting[0]!) };
        }
        return {
            title,
            status: t('updates.summary.available', { count: waiting.length }),
            tone: required ? 'attention' : 'info',
            action: { kind: 'group', label: t('updates.action.update') },
        };
    }

    const ready = group.items.find((item) => item.state === 'ready');
    if (ready) return { title, status: namedItemStatus(ready), tone: 'info', action: runnableAction(ready) };

    if (group.items.some((item) => item.state === 'checking')) {
        return { title, status: t('updates.row.checking'), tone: 'pending', action: null };
    }
    if (group.items.some((item) => item.state === 'unknown')) {
        return { title, status: t('updates.settingsSubtitle.unknown'), tone: 'neutral', action: null };
    }
    if (group.items.some((item) => item.state === 'unchecked')) {
        return { title, status: t('updates.summary.notCheckedYet'), tone: 'neutral', action: null };
    }
    return { title, status: t('updates.settingsSubtitle.upToDate'), tone: 'ok', action: null };
}
