import { mergeModuleMock, type MergeModuleMockOptions } from './_shared';

type ServerAccountRequestContextModule = typeof import('@/sync/runtime/orchestration/serverScopedRpc/resolveServerAccountRequestContext');

export type CreateServerAccountRequestContextModuleMockOptions = MergeModuleMockOptions<ServerAccountRequestContextModule>;

export async function createServerAccountRequestContextModuleMock(
    options: CreateServerAccountRequestContextModuleMockOptions,
): Promise<ServerAccountRequestContextModule> {
    return mergeModuleMock<ServerAccountRequestContextModule>(options);
}

export function installServerAccountRequestContextModuleMock(
    overrides: Partial<ServerAccountRequestContextModule>,
) {
    return async (importOriginal: <T>() => Promise<T>) => createServerAccountRequestContextModuleMock({
        importOriginal,
        overrides,
    });
}
