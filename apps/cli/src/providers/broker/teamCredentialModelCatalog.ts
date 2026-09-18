import type {
  ProviderBrokerApplicationBindingV1,
} from '@happier-dev/protocol';
import type {
  TeamCredentialProviderModelCatalogEntryV1,
} from '@happier-dev/protocol/teams';

export type TeamCredentialModelCatalogResolver = Readonly<{
  resourceId: string;
  resourceRevision: number;
  sourceRevision: string;
  application: ProviderBrokerApplicationBindingV1;
  rows: readonly TeamCredentialProviderModelCatalogEntryV1[];
  resolveCanonicalModelId(requestedModelId: string): string | null;
}>;

export type TeamCredentialExternalModelCatalog = Readonly<{
  applications: readonly ProviderBrokerApplicationBindingV1[];
  models: readonly Readonly<{ id: string; name?: string }>[];
  resolveCanonicalModelId(requestedModelId: string): string | null;
}>;

export function isSameTeamCredentialBrokerApplication(
  left: ProviderBrokerApplicationBindingV1,
  right: ProviderBrokerApplicationBindingV1,
): boolean {
  return left.agentTargetKey === right.agentTargetKey
    && left.implementationIdentity.pluginId === right.implementationIdentity.pluginId
    && left.implementationIdentity.localId === right.implementationIdentity.localId
    && left.endpointTemplateId === right.endpointTemplateId
    && left.protocol === right.protocol;
}

function applicationKey(application: ProviderBrokerApplicationBindingV1): string {
  return [
    application.agentTargetKey,
    application.implementationIdentity.pluginId,
    application.implementationIdentity.localId,
    application.endpointTemplateId,
    application.protocol,
  ].join('\0');
}

/**
 * Projects the protocol-neutral external model endpoint from exact current
 * application catalogs. A repeated model id is retained only when its full
 * canonical descriptor has identical bytes in every contributing catalog;
 * otherwise that id is omitted as ambiguous. No application is selected as a
 * default for later inference.
 */
export function createTeamCredentialExternalModelCatalog(
  catalogs: readonly TeamCredentialModelCatalogResolver[],
): TeamCredentialExternalModelCatalog | null {
  if (catalogs.length === 0) return null;
  const applicationsByKey = new Map<string, ProviderBrokerApplicationBindingV1>();
  const descriptorById = new Map<string, Readonly<{
    bytes: string;
    descriptor: TeamCredentialProviderModelCatalogEntryV1['descriptor'];
    conflict: boolean;
  }>>();
  const modelOrder: string[] = [];
  for (const catalog of catalogs) {
    applicationsByKey.set(applicationKey(catalog.application), catalog.application);
    for (const row of catalog.rows) {
      const modelId = row.descriptor.id;
      const bytes = JSON.stringify(row.descriptor);
      const existing = descriptorById.get(modelId);
      if (!existing) {
        modelOrder.push(modelId);
        descriptorById.set(modelId, { bytes, descriptor: row.descriptor, conflict: false });
      } else if (existing.bytes !== bytes) {
        descriptorById.set(modelId, { ...existing, conflict: true });
      }
    }
  }
  const retained = modelOrder.flatMap((modelId) => {
    const entry = descriptorById.get(modelId);
    return entry && !entry.conflict ? [entry.descriptor] : [];
  });
  if (retained.length === 0) return null;
  const candidatesBySpelling = new Map<string, Set<string>>();
  for (const descriptor of retained) {
    for (const spelling of [descriptor.id, ...(descriptor.aliases ?? [])]) {
      const candidates = candidatesBySpelling.get(spelling) ?? new Set<string>();
      candidates.add(descriptor.id);
      candidatesBySpelling.set(spelling, candidates);
    }
  }
  return Object.freeze({
    applications: Object.freeze([...applicationsByKey.values()]),
    models: Object.freeze(retained.map((descriptor) => Object.freeze({
      id: descriptor.id,
      ...(descriptor.name === undefined ? {} : { name: descriptor.name }),
    }))),
    resolveCanonicalModelId(requestedModelId) {
      const candidates = candidatesBySpelling.get(requestedModelId);
      if (!candidates || candidates.size !== 1) return null;
      return candidates.values().next().value ?? null;
    },
  });
}

/**
 * Binds request-model resolution to one exact current resource/source catalog.
 * Every published spelling participates in collision detection, including a
 * spelling that is canonical for one row and an alias for another. Unknown,
 * ambiguous, stale, mixed-source, and wrong-application catalogs fail closed.
 */
export function createTeamCredentialModelCatalogResolver(input: Readonly<{
  resourceId: string;
  resourceRevision: number;
  application: ProviderBrokerApplicationBindingV1;
  rows: readonly TeamCredentialProviderModelCatalogEntryV1[];
}>): TeamCredentialModelCatalogResolver | null {
  if (input.rows.length === 0) return null;
  const sourceRevisions = new Set<string>();
  const candidatesBySpelling = new Map<string, Set<string>>();
  const rows: TeamCredentialProviderModelCatalogEntryV1[] = [];
  for (const row of input.rows) {
    if (
      row.availability !== 'available'
      || row.selection.resourceId !== input.resourceId
      || row.selection.expectedResourceRevision !== input.resourceRevision
      || row.selection.modelId !== row.descriptor.id
      || !isSameTeamCredentialBrokerApplication(row.application, input.application)
    ) return null;
    sourceRevisions.add(row.sourceRevision);
    rows.push(Object.freeze({
      ...row,
      selection: Object.freeze({ ...row.selection }),
      descriptor: Object.freeze({
        ...row.descriptor,
        ...(row.descriptor.aliases
          ? { aliases: [...row.descriptor.aliases] }
          : {}),
      }),
      application: Object.freeze({
        ...row.application,
        implementationIdentity: Object.freeze({
          ...row.application.implementationIdentity,
        }),
      }),
    }));
    for (const spelling of [row.descriptor.id, ...(row.descriptor.aliases ?? [])]) {
      const targets = candidatesBySpelling.get(spelling) ?? new Set<string>();
      targets.add(row.descriptor.id);
      candidatesBySpelling.set(spelling, targets);
    }
  }
  if (sourceRevisions.size !== 1) return null;
  const [sourceRevision] = sourceRevisions;
  if (!sourceRevision) return null;
  return Object.freeze({
    resourceId: input.resourceId,
    resourceRevision: input.resourceRevision,
    sourceRevision,
    application: Object.freeze({
      ...input.application,
      implementationIdentity: Object.freeze({
        ...input.application.implementationIdentity,
      }),
    }),
    rows: Object.freeze(rows),
    resolveCanonicalModelId(requestedModelId) {
      const targets = candidatesBySpelling.get(requestedModelId);
      if (!targets || targets.size !== 1) return null;
      return targets.values().next().value ?? null;
    },
  });
}
