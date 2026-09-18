/**
 * Semantic Agent terminal authoring contract.
 *
 * The package graph itself is owned exclusively by `api-surface.json`. Tests
 * project entrypoints and exported names from that inventory instead of
 * maintaining a second package-surface registry here.
 */
export const AGENT_RUNTIME_TERMINAL_AUTHOR_CONTRACT = [
    'AgentTerminalControlPresentation',
    'AgentTerminalHostCreateOrAttachRequest',
    'AgentTerminalHostDisposeIntent',
    'AgentTerminalHostLaunchInput',
    'TerminalHostLiveness',
    'AgentTerminalHostResolutionReason',
    'AgentTerminalHostResolveRequest',
    'AgentTerminalHostResolveResult',
    'AgentTerminalHostService',
    'AgentTerminalLaunchPlan',
    'AgentTerminalSurface',
    'TerminalControlPort',
    'TerminalHostHandle',
    'TerminalHostKind',
    'TerminalHostPreference',
    'TerminalInputInjectionResult',
    'TerminalInputState',
    'TerminalPromptInput',
] as const;

export type ApiSurfaceInventoryContract = Readonly<{
    entrypoints: readonly Readonly<{
        specifier: string;
        sourceModule: string;
        visibility: 'author' | 'host';
    }>[];
    symbols: readonly Readonly<{
        specifier: string;
        exportName: string;
    }>[];
}>;

export type AuthorSurfaceContract = Readonly<{
    entrypoints: Readonly<Record<string, string>>;
    exports: Readonly<Record<string, readonly string[]>>;
}>;

/** Package-relative location every inventory-backed contract reads. */
export const API_SURFACE_INVENTORY_PATH = 'packages/plugin-sdk/api-surface.json';

/**
 * Single owner of the missing-inventory failure for every inventory-backed
 * contract test.
 *
 * Absence must fail loudly: degrading the inventory-backed cases to `it.skip`
 * made a missing inventory look like a green public-surface contract (plan
 * UI-D23). The inventory is a tracked generated artifact, so its absence or
 * unavailability must name the file and the canonical commands that regenerate
 * it from package source and check its currentness.
 */
export function requireApiSurfaceInventory<TInventory>(
    read: Readonly<
        | { status: 'available'; inventory: TInventory }
        | { status: 'missing' }
    >,
): TInventory {
    if (read.status === 'available') return read.inventory;
    throw new Error([
        `${API_SURFACE_INVENTORY_PATH} is missing or unavailable, so the Plugin SDK`,
        'public-surface contract cannot be checked. This tracked generated artifact',
        'must be regenerated from package source with',
        '`yarn workspace @happier-dev/plugin-sdk api-surface --write`, then checked',
        'against the current source with',
        '`yarn workspace @happier-dev/plugin-sdk api-surface --check`.',
    ].join(' '));
}

/** Derives test assertions directly from the tracked package inventory. */
export function projectAuthorSurfaceContract(
    inventory: ApiSurfaceInventoryContract,
): AuthorSurfaceContract {
    const authorEntrypoints = inventory.entrypoints.filter(
        (entrypoint) => entrypoint.visibility === 'author',
    );
    const authorSpecifiers = new Set(
        authorEntrypoints.map((entrypoint) => entrypoint.specifier),
    );
    const exports = Object.fromEntries(
        authorEntrypoints.map((entrypoint) => [entrypoint.specifier, [] as string[]]),
    );

    for (const symbol of inventory.symbols) {
        if (authorSpecifiers.has(symbol.specifier)) {
            exports[symbol.specifier]?.push(symbol.exportName);
        }
    }

    return {
        entrypoints: Object.fromEntries(authorEntrypoints.map((entrypoint) => [
            entrypoint.specifier,
            entrypoint.sourceModule,
        ])),
        exports,
    };
}
