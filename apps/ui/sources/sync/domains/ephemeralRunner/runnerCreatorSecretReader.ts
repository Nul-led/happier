import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { resolveSettingsSecretsKeySet } from '@/sync/encryption/resolveSettingsSecretsKeySet';
import { decryptSecretValueWithKeys, type SecretString } from '@/sync/encryption/secretSettings';

export type RunnerCreatorSecretReader = (value: SecretString | null | undefined) => string | null;

/**
 * Reads Account settings secrets for the exact Home/Account a Temporary computer
 * launch is qualified to.
 *
 * Profile environment values, MCP secrets and Connected Service secrets are all
 * settings secrets, so they all open with the one canonical settings-secret key
 * set derived from that Account's credentials. Neither the focused sync
 * singleton's keys (which belong to whichever Account is in view) nor the
 * Account content *public* key can open them: a cross-Home launch reading either
 * would silently produce an empty environment instead of a launch the endpoint
 * could actually run.
 */
export async function createRunnerCreatorSecretReader(input: Readonly<{
    credentials: AuthCredentials;
    scope: ServerAccountScope;
}>): Promise<RunnerCreatorSecretReader> {
    const keySet = await resolveSettingsSecretsKeySet(input);
    const readKeys = keySet?.readKeys ?? [];
    return (value) => decryptSecretValueWithKeys(value, readKeys);
}
