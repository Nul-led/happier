type ParamValue = string | string[] | undefined;

function firstString(value: ParamValue): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] ?? '';
    return '';
}

function parseBoolean(value: string): boolean {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function parseSource(value: string): 'notification' | null {
    const v = value.trim().toLowerCase();
    if (v === 'notification') return 'notification';
    return null;
}

function normalizeServerIds(values: readonly unknown[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of values) {
        if (typeof raw !== 'string') continue;
        const serverId = raw.trim();
        if (!serverId || seen.has(serverId)) continue;
        seen.add(serverId);
        result.push(serverId);
    }
    return result;
}

function parseServerIds(value: string): string[] {
    if (!value.trim()) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? normalizeServerIds(parsed) : [];
    } catch {
        return [];
    }
}

export function parseServerSettingsRouteParams(params: Readonly<{
    url?: ParamValue;
    auto?: ParamValue;
    source?: ParamValue;
    groupEditor?: ParamValue;
    groupServerIds?: ParamValue;
}>): Readonly<{
    url: string | null;
    auto: boolean;
    source: 'notification' | null;
    groupEditor: boolean;
    initialGroupServerIds: readonly string[];
}> {
    const url = firstString(params.url).trim();
    const autoRaw = firstString(params.auto);
    const sourceRaw = firstString(params.source);
    const groupEditorRaw = firstString(params.groupEditor);
    const groupServerIdsRaw = firstString(params.groupServerIds);
    return {
        url: url ? url : null,
        auto: autoRaw ? parseBoolean(autoRaw) : false,
        source: sourceRaw ? parseSource(sourceRaw) : null,
        groupEditor: groupEditorRaw ? parseBoolean(groupEditorRaw) : false,
        initialGroupServerIds: parseServerIds(groupServerIdsRaw),
    };
}

export function buildServerSettingsGroupEditorHref(input: Readonly<{
    initialGroupServerIds: readonly string[];
}>): Readonly<{
    pathname: '/settings/server';
    params: Readonly<{ groupEditor: '1'; groupServerIds: string }>;
}> {
    return {
        pathname: '/settings/server',
        params: {
            groupEditor: '1',
            groupServerIds: JSON.stringify(normalizeServerIds(input.initialGroupServerIds)),
        },
    };
}
