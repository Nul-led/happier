export const CLAUDE_USAGE_WINDOW_LABELS: Readonly<Record<string, string>> = Object.freeze({
    five_hour: '5-hour',
    seven_day: 'Weekly',
    seven_day_oauth_apps: 'Weekly (OAuth apps)',
    seven_day_sonnet: 'Weekly (Sonnet)',
    seven_day_opus: 'Weekly (Opus)',
    iguana_necktie: 'Unknown',
});

const WINDOW_LABEL_PREFIXES: ReadonlyArray<Readonly<{
    prefix: string;
    label: string;
}>> = [
    { prefix: 'five_hour_', label: '5-hour' },
    { prefix: 'seven_day_', label: 'Weekly' },
];

const WINDOW_LABEL_TOKEN_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
    api: 'API',
    fable: 'Fable',
    mcp: 'MCP',
    oauth: 'OAuth',
    opus: 'Opus',
    sonnet: 'Sonnet',
});

function formatWindowLabelSuffix(raw: string): string {
    return raw
        .split('_')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
        .map((part) => WINDOW_LABEL_TOKEN_OVERRIDES[part] ?? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

export function resolveClaudeUsageWindowLabel(meterId: string): string {
    const known = CLAUDE_USAGE_WINDOW_LABELS[meterId];
    if (known) return known;
    for (const { prefix, label } of WINDOW_LABEL_PREFIXES) {
        if (meterId.startsWith(prefix)) {
            const suffix = formatWindowLabelSuffix(meterId.slice(prefix.length));
            return suffix ? `${label} (${suffix})` : label;
        }
    }
    return formatWindowLabelSuffix(meterId) || meterId;
}
