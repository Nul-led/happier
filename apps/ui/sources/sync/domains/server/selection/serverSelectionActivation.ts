export type ServerSelectionActivationAuthStatus = 'signedIn' | 'signedOut' | 'unknown';

export type ServerSelectionGroupActivation = Readonly<{
    serverId: string;
    authStatus: ServerSelectionActivationAuthStatus;
}>;

/**
 * Chooses the one Home that must own focus when a group becomes effective.
 * Credential lookup stays at the caller-provided boundary; the ordering decision lives here.
 */
export async function resolveServerSelectionGroupActivation(params: Readonly<{
    currentServerId: string;
    serverIds: ReadonlyArray<string>;
    resolveAuthStatus: (serverId: string) => Promise<ServerSelectionActivationAuthStatus>;
}>): Promise<ServerSelectionGroupActivation | null> {
    const serverIds = Array.from(new Set(params.serverIds.map((id) => String(id ?? '').trim()).filter(Boolean)));
    if (serverIds.length === 0) return null;

    if (serverIds.includes(params.currentServerId)) {
        return {
            serverId: params.currentServerId,
            authStatus: await params.resolveAuthStatus(params.currentServerId),
        };
    }

    let fallback: ServerSelectionGroupActivation | null = null;
    for (const serverId of serverIds) {
        const authStatus = await params.resolveAuthStatus(serverId);
        const candidate = { serverId, authStatus } as const;
        fallback ??= candidate;
        if (authStatus === 'signedIn') return candidate;
    }
    return fallback;
}
