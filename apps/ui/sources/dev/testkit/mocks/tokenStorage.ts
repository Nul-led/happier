type TokenStorageModule = typeof import('@/auth/storage/tokenStorage');

export async function createTokenStorageModuleMock(options: Readonly<{
    importOriginal: <T = TokenStorageModule>() => Promise<T>;
    tokenStorage?: Partial<TokenStorageModule['TokenStorage']>;
    subscribeHomeCredentialMutations?: TokenStorageModule['subscribeHomeCredentialMutations'];
}>): Promise<TokenStorageModule> {
    const actual = await options.importOriginal<TokenStorageModule>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            ...options.tokenStorage,
        },
        subscribeHomeCredentialMutations: options.subscribeHomeCredentialMutations
            ?? (() => () => undefined),
    };
}
