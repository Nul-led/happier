import type { AccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import type { StoredCredentials } from '@/persistence';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { fetchServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { hydrateSavedSecretCatalog } from '@/settings/secrets/hydrateSavedSecretCatalog';

import type { McpCommandDeps } from './deps';

type FreshMcpAccountSettingsDeps = Pick<
  McpCommandDeps,
  'bootstrapAccountSettingsContext' | 'fetchServerFeaturesSnapshot' | 'hydrateSavedSecretCatalog'
>;

export async function loadFreshMcpAccountSettingsContext(
  credentials: StoredCredentials,
  deps: FreshMcpAccountSettingsDeps,
): Promise<AccountSettingsContext> {
  const settings = await deps.bootstrapAccountSettingsContext({
    credentials,
    mode: 'blocking',
    refresh: 'force',
  } as const);
  const serverFeaturesSnapshot = await (
    deps.fetchServerFeaturesSnapshot ?? fetchServerFeaturesSnapshot
  )({
    serverUrl: resolveServerHttpBaseUrl(),
    token: credentials.token,
    projection: 'authenticated',
  });
  const catalog = await (deps.hydrateSavedSecretCatalog ?? hydrateSavedSecretCatalog)({
    token: credentials.token,
    serverFeatures: serverFeaturesSnapshot.status === 'ready'
      ? serverFeaturesSnapshot.features
      : null,
  });
  return Object.freeze({
    ...settings,
    savedSecretResources: catalog.resources,
    savedSecretCatalogState: catalog.state,
  });
}
