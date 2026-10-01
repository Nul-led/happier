import type { ArtifactCallerAccessV1 } from './artifactAccessV1.js';
import { WorkflowDefinitionArtifactHeaderV1Schema } from '../workflows/workflowDefinitionV1.js';

export type ArtifactSharingResourceV1 = Readonly<{
  artifactId: string;
  header: Readonly<Record<string, unknown>>;
  body?: string | null;
  ownerAccountId?: string;
  access?: ArtifactCallerAccessV1;
  headerVersion?: number;
  revision?: Readonly<{ headerVersion: number; bodyVersion: number }>;
}>;

/**
 * Kind policy is supplied by the document's owner; the host owns transport and keys. Level words are
 * the UI adapters' (`components/sharing/documents`), not the protocol's.
 */
export type ArtifactSharingKindAdapterV1 = Readonly<{
  kind: string;
  canShare: (resource: ArtifactSharingResourceV1) => boolean;
}>;

export const workflowDefinitionArtifactSharingAdapterV1 = {
  kind: 'workflow-definition.v1',
  canShare: (resource: ArtifactSharingResourceV1) => {
    const parsed = WorkflowDefinitionArtifactHeaderV1Schema.safeParse(resource.header);
    if (!parsed.success || parsed.data.definitionId !== resource.artifactId) return false;
    const revision = resource.revision;
    const headerVersion = revision?.headerVersion ?? resource.headerVersion;
    return (headerVersion === undefined || parsed.data.revision.headerVersion === headerVersion)
      && (revision === undefined || parsed.data.revision.bodyVersion === revision.bodyVersion);
  },
} as const satisfies ArtifactSharingKindAdapterV1;

/** Only already-authorized, opened headers enter this projection; no foreign scan. */
export function filterArtifactSharingResourcesByKindV1<T extends ArtifactSharingResourceV1>(
  resources: readonly T[], adapter: ArtifactSharingKindAdapterV1,
): T[] {
  return resources.filter((resource) => resource.header.kind === adapter.kind && adapter.canShare(resource));
}
