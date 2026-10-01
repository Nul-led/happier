import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

import type { AgentModelConfig } from '@happier-dev/agents';
import type { AgentCatalogEntry } from '@/agent/catalog/types';
import { createAgentNativeHomeReadService } from '@/agent/runtime/nativeHomeFileService';
import { resolveConnectedServiceNativeHomeRoot } from '@/daemon/connectedServices/stateSharing/applyConnectedServiceStateSharingDescriptor';

export type NativeCatalogBearer = Readonly<{
  accessToken: string;
  credentialFingerprint: string;
}>;

function readJsonPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

export async function resolveNativeCatalogBearer(input: Readonly<{
  observation: NonNullable<AgentModelConfig['nativeCatalogObservation']>;
  catalogEntry: Pick<AgentCatalogEntry, 'getConnectedServiceStateSharingDescriptor'> | null | undefined;
  environment: Readonly<Record<string, string | undefined>>;
}>): Promise<NativeCatalogBearer | null> {
  const declaration = input.observation.nativeBearer;
  if (!declaration) return null;
  const descriptor = await input.catalogEntry?.getConnectedServiceStateSharingDescriptor?.().catch(() => null);
  if (descriptor?.providerSupportStatus !== 'supported' || !descriptor.nativeHome) return null;
  const readService = createAgentNativeHomeReadService({
    root: resolveConnectedServiceNativeHomeRoot({
      nativeHome: descriptor.nativeHome,
      sourceEnvironment: input.environment,
      homeDir: homedir(),
    }),
    declaredFileIds: descriptor.authIsolation.secretEntries,
  });
  if (!readService) return null;
  const bytes = (await readService.readFiles([declaration.fileId]))[declaration.fileId];
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const accessToken = readJsonPath(parsed, declaration.jsonPath);
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) return null;
  return Object.freeze({
    accessToken: accessToken.trim(),
    credentialFingerprint: `sha256:${createHash('sha256').update(accessToken.trim()).digest('hex')}`,
  });
}

export function isDynamicModelProbeEnabled(input: Readonly<{
  modelConfig: AgentModelConfig | null | undefined;
  accountSettings: Readonly<Record<string, unknown>> | null;
  environment: Readonly<Record<string, string | undefined>>;
}>): boolean {
  const control = input.modelConfig?.dynamicProbeControl;
  if (!control) return input.modelConfig?.dynamicProbe !== 'static-only';
  const environmentValue = control.environmentVariable
    ? input.environment[control.environmentVariable]?.trim().toLowerCase()
    : undefined;
  if (environmentValue === '0' || environmentValue === 'false') return false;
  return input.accountSettings?.[control.accountSettingId] !== false;
}
