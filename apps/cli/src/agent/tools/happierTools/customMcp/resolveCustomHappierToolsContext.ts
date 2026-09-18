import type { StoredCredentials } from '@/persistence';
import { readMcpServersSettingsFromAccountSettings } from '@/mcp/servers/readMcpServersSettingsFromAccountSettings';
import { resolveEffectiveMcpServersForDirectory } from '@/mcp/servers/resolveEffectiveMcpServersForDirectory';
import {
  deriveSettingsSecretsKeyForCredentials,
  deriveSettingsSecretsReadKeysForCredentials,
} from '@/mcp/servers/resolveMcpValueRefPlaintext';
import { materializeMcpServerConfigRecord } from '@/mcp/servers/materializeMcpServerConfigRecord';
import {
  createSavedSecretMaterializerV1,
  type SavedSecretCatalogResourceInputV1,
} from '@/settings/secrets/savedSecretCatalog';

export async function resolveCustomHappierToolsContext(params: Readonly<{
  credentials: StoredCredentials;
  accountSettings: Readonly<Record<string, unknown>>;
  machineId: string;
  directory: string;
  processEnv?: NodeJS.ProcessEnv;
  savedSecretResources?: readonly SavedSecretCatalogResourceInputV1[];
}>): Promise<Awaited<ReturnType<typeof materializeMcpServerConfigRecord>>> {
  const settings = readMcpServersSettingsFromAccountSettings(params.accountSettings);
  const resolved = resolveEffectiveMcpServersForDirectory({
    settings,
    machineId: params.machineId,
    directory: params.directory,
  });
  const savedSecretMaterializer = createSavedSecretMaterializerV1({
    accountSettings: params.accountSettings,
    settingsSecretsReadKeys: deriveSettingsSecretsReadKeysForCredentials(params.credentials),
    resources: params.savedSecretResources,
  });
  return await materializeMcpServerConfigRecord({
    resolved,
    savedSecretsById: new Map(),
    savedSecretMaterializer,
    settingsSecretsKey: params.credentials.encryption
      ? deriveSettingsSecretsKeyForCredentials(params.credentials)
      : null,
    settingsSecretsReadKeys: deriveSettingsSecretsReadKeysForCredentials(params.credentials),
    processEnv: params.processEnv ?? process.env,
    tmpDir: null,
    strictMode: resolved.strictMode,
  });
}
