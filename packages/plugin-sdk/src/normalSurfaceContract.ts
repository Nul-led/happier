/**
 * Semantic Agent terminal authoring contract.
 *
 * The package graph itself is owned exclusively by the generated API-surface
 * inventory. Tests project entrypoints and exported names from that inventory
 * instead of maintaining a second package-surface registry here.
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

/** Derives test assertions directly from the package inventory. */
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
