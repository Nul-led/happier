import { mergeModuleMock } from './_shared';

type AccountEncryptionModeModule = typeof import('@/sync/api/account/apiAccountEncryptionMode');

export async function createAccountEncryptionModeModuleMock(options: Readonly<{
    importOriginal: <T = AccountEncryptionModeModule>() => Promise<T>;
    overrides?: Partial<AccountEncryptionModeModule>;
}>): Promise<AccountEncryptionModeModule> {
    return await mergeModuleMock({
        importOriginal: options.importOriginal,
        overrides: options.overrides ?? {},
    });
}
