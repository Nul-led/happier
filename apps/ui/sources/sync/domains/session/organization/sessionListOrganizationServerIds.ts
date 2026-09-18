const EMPTY_SESSION_LIST_ORGANIZATION_SERVER_IDS: readonly string[] = Object.freeze([]);

function normalize(values: readonly string[] | null | undefined): readonly string[] {
    if (!values || values.length === 0) return EMPTY_SESSION_LIST_ORGANIZATION_SERVER_IDS;
    const normalized = [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
    return normalized.length > 0 ? normalized : EMPTY_SESSION_LIST_ORGANIZATION_SERVER_IDS;
}

/**
 * The exact Homes whose rows a Sessions surface can present, and therefore the exact Homes
 * whose organization state it must read.
 *
 * Both the index owner and the row/shell owner resolve this here so they can never disagree:
 * a query-sourced corpus presents exactly the Homes handed to the query owner, while the
 * incumbent ordinary corpus presents every mounted Home. Reading a narrower set than the
 * index presents leaves those rows without their pins, tags, folders, order or standing.
 */
export function resolveSessionListOrganizationServerIds(params: Readonly<{
    /**
     * Homes handed to the per-Home query/paging owner. `undefined` means no query owner is
     * mounted and the ordinary list is the source; an empty array is a proved-empty selection.
     */
    queryHomeServerIds?: readonly string[];
    /** Homes mounted by the Home selector. */
    allowedServerIds?: readonly string[] | null;
    /** Focused Home, used only before any Home is mounted. */
    activeServerId?: string | null;
}>): readonly string[] {
    if (params.queryHomeServerIds !== undefined) {
        return normalize(params.queryHomeServerIds);
    }
    const allowedServerIds = normalize(params.allowedServerIds);
    if (allowedServerIds.length > 0) return allowedServerIds;
    const activeServerId = String(params.activeServerId ?? '').trim();
    return activeServerId ? [activeServerId] : EMPTY_SESSION_LIST_ORGANIZATION_SERVER_IDS;
}
