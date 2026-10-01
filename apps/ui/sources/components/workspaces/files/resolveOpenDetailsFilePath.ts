type DetailsStateLike = Readonly<{
    isOpen: boolean;
    activeTabKey: string | null;
    tabs: ReadonlyArray<Readonly<{ key: string; resource: unknown }>>;
}>;

/**
 * The workspace file shown in Details right now (its active tab), so the Files tree can keep that
 * row selected while its tab is open (lab F1). `null` when Details is closed or shows something else.
 */
export function resolveOpenDetailsFilePath(details: DetailsStateLike | null | undefined): string | null {
    if (!details?.isOpen || !details.activeTabKey) return null;
    const resource = details.tabs.find((tab) => tab.key === details.activeTabKey)?.resource;
    if (!resource || typeof resource !== 'object') return null;
    const { kind, path } = resource as { kind?: unknown; path?: unknown };
    return kind === 'file' && typeof path === 'string' && path.length > 0 ? path : null;
}
