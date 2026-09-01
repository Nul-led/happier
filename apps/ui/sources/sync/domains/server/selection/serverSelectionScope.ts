export type ServerSelectionScope = 'tab' | 'device';

/** Routine browser selection is tab-local; desktop-hosted and native apps are device-scoped. */
export function resolveRoutineServerSelectionScope(
    platformOS: string,
    desktopHost = false,
): ServerSelectionScope {
    return platformOS === 'web' && !desktopHost ? 'tab' : 'device';
}
