import {
  resolveConnectedServiceSessionSelection,
} from '@happier-dev/agents';
import {
  BuiltInLegacyConnectedServicesDefaultAuthByAgentIdV1IngressSchema,
  ConnectedServicesDefaultAuthByAgentIdV1Schema,
  ConnectedServiceBindingsV2Schema,
  TeamCredentialResourceEntitledPageV1Schema,
  buildQualifiedPluginContributionKey,
  type ActionExecutorDeps,
  type ConnectedServiceBindingSelectionV1,
  type ConnectedServiceBindingSelectionV2,
  type ConnectedServiceBindingsV2,
  type ConnectedServicesDefaultAuthTeamResourceBindingV2,
  type TeamCredentialResourceCatalogEntryV1,
  type TeamResourceConnectedServiceSelectionV2,
} from '@happier-dev/protocol';

import type { StoredCredentials } from '@/persistence';
import { resolveCatalogAgentConnectedAccountServiceIds } from '@/agent/catalog/registry';
import { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';

export function agentSupportsSpawnConnectedServicesDefaults(agentId: string): boolean {
  return resolveCatalogAgentConnectedAccountServiceIds(agentId).length > 0;
}

export type SpawnConnectedServicesDefaultDisposition =
  | Readonly<{ kind: 'connected'; bindings: ConnectedServiceBindingsV2 }>
  | Readonly<{ kind: 'native' }>
  | Readonly<{
      kind: 'unavailable';
      reason:
        | 'connected_services_default_settings_invalid'
        | 'connected_services_team_default_requires_current_resource';
    }>;

export type SpawnConnectedServicesTeamResourceCatalog = Readonly<{
  serverId: string;
  accountId: string;
  resources: readonly TeamCredentialResourceCatalogEntryV1[];
}>;

export type ResolveSpawnConnectedServicesTeamResourceCatalog = (params: Readonly<{
  teamIds: readonly string[];
}>) => Promise<SpawnConnectedServicesTeamResourceCatalog | null>;

function readRecipientCatalogNextCursor(page: object): string | null {
  if (!('nextCursor' in page)) return null;
  return typeof page.nextCursor === 'string' ? page.nextCursor : null;
}

export function createSpawnConnectedServicesTeamResourceCatalogResolver(params: Readonly<{
  homeDomainAction: NonNullable<ActionExecutorDeps['homeDomainAction']>;
  serverId: string;
  accountId: string;
}>): ResolveSpawnConnectedServicesTeamResourceCatalog {
  return async ({ teamIds }) => {
    const resources: TeamCredentialResourceCatalogEntryV1[] = [];
    for (const teamId of teamIds) {
      let cursor: string | null = null;
      do {
        const raw = await params.homeDomainAction({
          actionId: 'teams.credentials.entitled.list', input: { teamId, ...(cursor ? { cursor } : {}) },
          context: { surface: 'cli', serverId: params.serverId },
        });
        if (raw && typeof raw === 'object' && 'ok' in raw && raw.ok === false) return null;
        const parsed = TeamCredentialResourceEntitledPageV1Schema.safeParse(raw);
        if (!parsed.success) return null;
        resources.push(...parsed.data.resources);
        cursor = readRecipientCatalogNextCursor(parsed.data);
      } while (cursor);
    }
    return {
      serverId: params.serverId,
      accountId: params.accountId,
      resources,
    };
  };
}

export class ConnectedServicesDefaultUnavailableError extends Error {
  readonly code = 'connected_services_default_unavailable';

  constructor(readonly reason:
    | 'connected_services_default_settings_invalid'
    | 'connected_services_team_default_requires_current_resource') {
    super(reason);
  }
}

/**
 * THE session spawn-defaulting owner (one defaulting owner, one settings path — QA2-F02).
 *
 * Resolves the account-default connected-services selection for a catalog Agent from a FRESH,
 * bounded blocking account-settings bootstrap (`bootstrapAccountSettingsContext` mode 'blocking';
 * its network reads carry internal 15s timeouts, so the wait is bounded). Callers must NEVER
 * substitute an in-process settings snapshot for this resolution: a second settings surface is
 * exactly the stale-snapshot split-brain that silently killed run defaulting live (QA2-F02).
 * Consumed by session spawn (createCliActionDeps) AND execution-run start (connectedServicesEnv).
 * Ordinary bootstrap failures retain the legacy no-default behavior. A
 * persisted Team-resource default is different: it is an explicit selection,
 * so missing or stale current-resource evidence throws the typed unavailable
 * error instead of silently falling back to native authentication.
 */
export async function resolveSessionSpawnConnectedServicesDefaultsPayload(params: Readonly<{
  agentId: string;
  credentials: StoredCredentials;
  resolveTeamCredentialResourceCatalog?: ResolveSpawnConnectedServicesTeamResourceCatalog;
}>): Promise<Readonly<{
  connectedServices: ConnectedServiceBindingsV2;
  connectedServicesUpdatedAt: number;
}> | null> {
  const agentId = params.agentId.trim();
  if (!agentSupportsSpawnConnectedServicesDefaults(agentId)) return null;

  try {
    const accountSettingsContext = await bootstrapAccountSettingsContext({
      credentials: params.credentials,
      mode: 'blocking',
      deps: { applySideEffects: () => undefined },
    });
    const teamIds = readTeamResourceDefaultTeamIds({
      accountSettings: accountSettingsContext.settings,
      agentId,
    });
    let teamCredentialResourceCatalog: SpawnConnectedServicesTeamResourceCatalog | undefined;
    if (teamIds.length > 0) {
      try {
        teamCredentialResourceCatalog = await params.resolveTeamCredentialResourceCatalog?.({ teamIds }) ?? undefined;
      } catch {
        throw new ConnectedServicesDefaultUnavailableError(
          'connected_services_team_default_requires_current_resource',
        );
      }
      if (!teamCredentialResourceCatalog) {
        throw new ConnectedServicesDefaultUnavailableError(
          'connected_services_team_default_requires_current_resource',
        );
      }
    }
    const disposition = resolveSpawnConnectedServicesDefaultDisposition({
      accountSettings: accountSettingsContext.settings,
      agentId,
      ...(teamCredentialResourceCatalog ? { teamCredentialResourceCatalog } : {}),
    });
    if (disposition.kind === 'unavailable') {
      throw new ConnectedServicesDefaultUnavailableError(disposition.reason);
    }
    if (disposition.kind === 'native') return null;
    return {
      connectedServices: disposition.bindings,
      connectedServicesUpdatedAt: Date.now(),
    };
  } catch (error) {
    if (error instanceof ConnectedServicesDefaultUnavailableError) throw error;
    return null;
  }
}

function readTeamResourceDefaultTeamIds(params: Readonly<{
  accountSettings: unknown;
  agentId: string;
}>): readonly string[] {
  const settingsRecord = params.accountSettings && typeof params.accountSettings === 'object' && !Array.isArray(params.accountSettings)
    ? params.accountSettings as { connectedServicesDefaultAuthByAgentIdV1?: unknown }
    : {};
  const parsed = ConnectedServicesDefaultAuthByAgentIdV1Schema.safeParse(
    settingsRecord.connectedServicesDefaultAuthByAgentIdV1,
  );
  if (!parsed.success) return [];
  const bindings = parsed.data.bindingsByAgentId[params.agentId]?.bindingsByServiceId ?? {};
  return Array.from(new Set(Object.values(bindings).flatMap((binding) => (
    binding.source === 'team_resource' ? [binding.teamId] : []
  ))));
}

function normalizeBindingForSpawn(
  serviceId: string,
  binding: ConnectedServiceBindingSelectionV1 | undefined,
): ConnectedServiceBindingSelectionV1 {
  const resolution = resolveConnectedServiceSessionSelection({
    serviceId,
    binding,
    availability: { kind: 'deferred' },
  });
  return resolution.status === 'no_selection'
    ? { source: 'native' }
    : { source: 'connected', ...resolution.selection };
}

function isTeamResourceDefaultBinding(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as { source?: unknown }).source === 'team_resource');
}

function resolveCurrentTeamResourceDefaultBinding(params: Readonly<{
  serviceId: string;
  binding: ConnectedServicesDefaultAuthTeamResourceBindingV2;
  catalog: SpawnConnectedServicesTeamResourceCatalog | undefined;
}>): TeamResourceConnectedServiceSelectionV2 | null {
  const { binding, catalog } = params;
  if (
    !catalog
    || catalog.serverId !== binding.serverId
    || catalog.accountId !== binding.accountId
  ) return null;

  const resource = catalog.resources.find((candidate) => (
    candidate.id === binding.resourceId
    && candidate.teamId === binding.teamId
    && candidate.resourceRevision === binding.expectedResourceRevision
    && candidate.readiness.kind === 'available'
    && candidate.sourcePresentation?.kind === 'connected_service'
    && buildQualifiedPluginContributionKey(candidate.sourcePresentation.service) === params.serviceId
  ));
  if (!resource) return null;

  return resource.connectedServiceSelections.find((selection) => {
    if (
      selection.resourceId !== binding.resourceId
      || selection.deliveryMode !== binding.deliveryMode
    ) return false;
    if (selection.deliveryMode === 'brokered') return true;
    if (binding.deliveryMode !== 'direct') return false;
    return selection.disclosedMember.accountId === binding.disclosedMember.accountId
      && selection.disclosedMember.service.pluginId === binding.disclosedMember.service.pluginId
      && selection.disclosedMember.service.localId === binding.disclosedMember.service.localId;
  }) ?? null;
}

function isLegacySpawnBinding(
  value: unknown,
): value is ConnectedServiceBindingSelectionV1 {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && ((value as { source?: unknown }).source === 'native'
      || (value as { source?: unknown }).source === 'connected'));
}

export function resolveSpawnConnectedServicesDefaultDisposition(params: Readonly<{
  accountSettings: unknown;
  agentId: string;
  teamCredentialResourceCatalog?: SpawnConnectedServicesTeamResourceCatalog;
}>): SpawnConnectedServicesDefaultDisposition {
  const supportedServiceIds = resolveCatalogAgentConnectedAccountServiceIds(params.agentId);
  if (supportedServiceIds.length === 0) return { kind: 'native' };

  const settingsRecord = params.accountSettings && typeof params.accountSettings === 'object' && !Array.isArray(params.accountSettings)
    ? params.accountSettings as { connectedServicesDefaultAuthByAgentIdV1?: unknown }
    : {};
  if (!Object.prototype.hasOwnProperty.call(settingsRecord, 'connectedServicesDefaultAuthByAgentIdV1')) {
    return { kind: 'native' };
  }
  const rawDefaults = settingsRecord.connectedServicesDefaultAuthByAgentIdV1;
  const currentDefaults = ConnectedServicesDefaultAuthByAgentIdV1Schema.safeParse(rawDefaults);
  const parsedDefaults = BuiltInLegacyConnectedServicesDefaultAuthByAgentIdV1IngressSchema.safeParse(rawDefaults);
  if (!parsedDefaults.success) {
    return {
      kind: 'unavailable',
      reason: 'connected_services_default_settings_invalid',
    };
  }

  const configuredBindings = parsedDefaults.data.bindingsByAgentId[params.agentId]?.bindingsByServiceId ?? {};
  const currentBindings = currentDefaults.success
    ? currentDefaults.data.bindingsByAgentId[params.agentId]?.bindingsByServiceId ?? {}
    : {};
  const bindingsByServiceId: Record<string, ConnectedServiceBindingSelectionV2> = {};
  let hasNonNativeBinding = false;

  for (const serviceId of supportedServiceIds) {
    const currentBinding = currentBindings[serviceId];
    if (isTeamResourceDefaultBinding(currentBinding)) {
      const teamBinding = currentBinding as ConnectedServicesDefaultAuthTeamResourceBindingV2;
      const resolved = resolveCurrentTeamResourceDefaultBinding({
        serviceId,
        binding: teamBinding,
        catalog: params.teamCredentialResourceCatalog,
      });
      if (!resolved) {
        return {
          kind: 'unavailable',
          reason: 'connected_services_team_default_requires_current_resource',
        };
      }
      bindingsByServiceId[serviceId] = resolved;
      hasNonNativeBinding = true;
      continue;
    }
    const configuredBinding = configuredBindings[serviceId];
    const binding = normalizeBindingForSpawn(
      serviceId,
      isLegacySpawnBinding(configuredBinding) ? configuredBinding : undefined,
    );
    bindingsByServiceId[serviceId] = binding;
    if (binding.source === 'connected') {
      hasNonNativeBinding = true;
    }
  }

  if (!hasNonNativeBinding) return { kind: 'native' };
  return {
    kind: 'connected',
    bindings: ConnectedServiceBindingsV2Schema.parse({
      v: 2,
      bindingsByServiceId,
    }),
  };
}

export function resolveSpawnConnectedServicesDefaults(params: Readonly<{
  accountSettings: unknown;
  agentId: string;
  teamCredentialResourceCatalog?: SpawnConnectedServicesTeamResourceCatalog;
}>): ConnectedServiceBindingsV2 | null {
  const disposition = resolveSpawnConnectedServicesDefaultDisposition(params);
  return disposition.kind === 'connected' ? disposition.bindings : null;
}
