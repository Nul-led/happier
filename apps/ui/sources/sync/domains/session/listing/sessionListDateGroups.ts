import { t } from '@/text';

export type SessionListDateGroup<T> = Readonly<{
    dateKey: string;
    title: string;
    items: ReadonlyArray<T>;
}>;

function toLocalDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resolveDateGroupTitle(timestamp: number, nowMs: number): string {
    const groupDate = new Date(timestamp);
    const sessionDateOnly = new Date(groupDate.getFullYear(), groupDate.getMonth(), groupDate.getDate());
    const now = new Date(nowMs);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    if (sessionDateOnly.getTime() === today.getTime()) {
        return t('sessionHistory.today');
    }
    if (sessionDateOnly.getTime() === yesterday.getTime()) {
        return t('sessionHistory.yesterday');
    }
    const diffDays = Math.floor((today.getTime() - sessionDateOnly.getTime()) / (24 * 60 * 60 * 1000));
    return t('sessionHistory.daysAgo', { count: diffDays });
}

export function buildSessionListDateGroups<T>(params: Readonly<{
    items: ReadonlyArray<T>;
    readMeaningfulActivityAt: (item: T) => number;
    nowMs?: number;
}>): ReadonlyArray<SessionListDateGroup<T>> {
    const groups: Array<{ dateKey: string; title: string; items: T[] }> = [];
    const nowMs = params.nowMs ?? Date.now();
    for (const item of params.items) {
        const timestamp = params.readMeaningfulActivityAt(item);
        const dateKey = toLocalDateKey(timestamp);
        const current = groups[groups.length - 1];
        if (current?.dateKey === dateKey) {
            current.items.push(item);
            continue;
        }
        groups.push({
            dateKey,
            title: resolveDateGroupTitle(timestamp, nowMs),
            items: [item],
        });
    }
    return groups;
}
