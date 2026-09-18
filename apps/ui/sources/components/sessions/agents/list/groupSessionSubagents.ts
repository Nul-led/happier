import type { SessionAgentActivityRow } from '@/components/sessions/agents/presentation/sessionAgentActivityRows';

export type SessionSubagentGroupModel = Readonly<{
    key: string;
    label: string | null;
    items: readonly SessionAgentActivityRow[];
}>;

/**
 * Rows grouped by the team/group they belong to, in first-seen order.
 *
 * Grouping reads the locally derived row because the group key is an operational fact (which team
 * spawned this agent) that the published headline does not carry.
 */
export function groupSessionSubagents(
    rows: readonly SessionAgentActivityRow[],
): readonly SessionSubagentGroupModel[] {
    const orderedKeys: string[] = [];
    const groups = new Map<string, SessionAgentActivityRow[]>();

    for (const row of rows) {
        const key = row.subagent.display.groupKey?.trim() || '__ungrouped__';
        if (!groups.has(key)) {
            groups.set(key, []);
            orderedKeys.push(key);
        }
        groups.get(key)!.push(row);
    }

    return orderedKeys.map((key) => {
        const items = groups.get(key) ?? [];
        return {
            key,
            label: key === '__ungrouped__' ? null : (items[0]?.subagent.display.groupLabel?.trim() || key),
            items,
        };
    });
}
