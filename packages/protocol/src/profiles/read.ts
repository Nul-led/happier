import { AIBackendProfileSchema } from './backendProfileSchema.js';
import {
  projectHistoricalBuiltInAiLaunchProfileV1,
  type HistoricalAiBackendProfileV1,
} from './historicalCompatibilityV1.js';
import { LaunchProfileV2Schema, type LaunchProfileV2 } from './v2/schema.js';
import type { ProviderSettingsMigrationStateV1 } from '../providers/settings/v1.js';
import type { ArtifactSharingResourceV1 } from '../artifacts/artifactSharingV1.js';
import { LaunchProfileArtifactReferenceV1Schema, readLaunchProfileArtifactV1 } from '../launchProfiles/launchProfileArtifactV1.js';

export type AiLaunchProfileSourceV1 = Readonly<{
  artifactId?: string;
  secretBindings?: Readonly<Record<string, string>>;
  shared?: boolean;
  viewOnly?: boolean;
  revision?: Readonly<{ headerVersion: number; bodyVersion: number }>;
}>;
export type AiLaunchProfile = (HistoricalAiBackendProfileV1 | LaunchProfileV2) & AiLaunchProfileSourceV1;

export function isLaunchProfileV2(profile: AiLaunchProfile): profile is LaunchProfileV2 {
  return 'v' in profile && profile.v === 2;
}

type ArtifactProfileSource = AiLaunchProfileSourceV1;
export type AiLaunchProfileCollectionEntry =
  | (Readonly<{ kind: 'legacy'; profile: HistoricalAiBackendProfileV1 & AiLaunchProfileSourceV1; raw: unknown }> & ArtifactProfileSource)
  | (Readonly<{ kind: 'slim'; profile: LaunchProfileV2 & AiLaunchProfileSourceV1; raw: unknown }> & ArtifactProfileSource)
  | Readonly<{ kind: 'opaque'; raw: unknown }>;

export type AiLaunchProfileReadDiagnostic = Readonly<{
  index: number;
  reason: 'future_version' | 'malformed' | 'artifact_unavailable';
}>;

export type AiLaunchProfileCollectionReadResult = Readonly<{
  raw: unknown;
  entries: readonly AiLaunchProfileCollectionEntry[];
  diagnostics: readonly AiLaunchProfileReadDiagnostic[];
}>;

// Historical built-ins are not guaranteed to be persisted in `profiles`, but their
// SavedSecret bindings can exist before the daemon-owned atomic migration runs.
// Keep this compatibility inventory in the protocol reader rather than duplicating
// provider/profile knowledge in UI pruning code.
const LEGACY_AI_LAUNCH_BUILT_IN_PROFILE_IDS_V1 = new Set([
  'anthropic',
  'codex',
  'gemini',
  'deepseek',
  'zai',
  'openai',
  'azure-openai',
  'gemini-api-key',
  'gemini-vertex',
]);

export function isHistoricalBuiltInAiLaunchProfileIdV1(profileId: string): boolean {
  return LEGACY_AI_LAUNCH_BUILT_IN_PROFILE_IDS_V1.has(profileId);
}

export function readAiLaunchProfileCollection(raw: unknown, options?: Readonly<{
  /** Already-authorized, opened documents; this reader never fetches foreign data. */
  artifactsById: ReadonlyMap<string, ArtifactSharingResourceV1>;
  includeShared?: boolean;
}>): AiLaunchProfileCollectionReadResult {
  const entries: AiLaunchProfileCollectionEntry[] = [];
  const diagnostics: AiLaunchProfileReadDiagnostic[] = [];
  (Array.isArray(raw) ? raw : []).forEach((entry, index) => {
    const reference = LaunchProfileArtifactReferenceV1Schema.safeParse(entry);
    if (reference.success) {
      const resource = options?.artifactsById.get(reference.data.artifactId);
      const content = resource?.artifactId === reference.data.artifactId ? readLaunchProfileArtifactV1(resource) : null;
      if (!content) {
        diagnostics.push({ index, reason: 'artifact_unavailable' });
        entries.push({ kind: 'opaque', raw: entry });
      } else {
        const source = { artifactId: reference.data.artifactId, secretBindings: content.secretBindings,
          shared: resource?.access === 'view' || resource?.access === 'edit' || resource?.access === 'admin',
          viewOnly: resource?.access === 'view', ...(resource?.revision ? { revision: resource.revision } : {}) };
        if ('v' in content.profile) entries.push({ kind: 'slim', profile: { ...content.profile, ...source }, raw: entry, ...source });
        else entries.push({ kind: 'legacy', profile: { ...projectHistoricalBuiltInAiLaunchProfileV1(content.profile), ...source }, raw: entry, ...source });
      }
      return;
    }
    const slim = LaunchProfileV2Schema.safeParse(entry);
    if (slim.success) {
      entries.push({ kind: 'slim', profile: slim.data, raw: entry });
      return;
    }
    const version = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Reflect.get(entry, 'v')
      : undefined;
    // A versioned row belongs to that version's schema. Never strip its version
    // and silently reinterpret malformed/future content as a legacy profile.
    const legacy = version === undefined ? AIBackendProfileSchema.safeParse(entry) : null;
    if (legacy?.success) {
      entries.push({
        kind: 'legacy',
        profile: projectHistoricalBuiltInAiLaunchProfileV1(legacy.data),
        raw: entry,
      });
      return;
    }
    diagnostics.push({ index, reason: typeof version === 'number' && version > 2 ? 'future_version' : 'malformed' });
    entries.push({ kind: 'opaque', raw: entry });
  });
  if (options?.includeShared) {
    const referenced = new Set((Array.isArray(raw) ? raw : []).flatMap((row) => {
      const reference = LaunchProfileArtifactReferenceV1Schema.safeParse(row);
      return reference.success ? [reference.data.artifactId] : [];
    }));
    for (const resource of options.artifactsById.values()) {
      if (resource.header.kind !== 'launch-profile.v1' || referenced.has(resource.artifactId) || !['view', 'edit', 'admin'].includes(resource.access ?? '')) continue;
      const shared = readAiLaunchProfileCollection([{ artifactId: resource.artifactId }], { artifactsById: options.artifactsById });
      entries.push(...shared.entries);
    }
  }
  return { raw, entries, diagnostics };
}

/** Fetching stays in the mode-aware, grant-authorized Artifact store; all hosts share this inventory. */
export async function loadAiLaunchProfileArtifacts(raw: unknown, store: Readonly<{
  read: (artifactId: string, options?: Readonly<{ signal?: AbortSignal }>) => Promise<ArtifactSharingResourceV1 | null>;
  list?: (options: Readonly<{ limit: number; cursor?: string; signal?: AbortSignal }>) => Promise<Readonly<{
    items: readonly ArtifactSharingResourceV1[]; nextCursor?: string;
  }>>;
}>, signal?: AbortSignal): Promise<ReadonlyMap<string, ArtifactSharingResourceV1>> {
  const ids = new Set<string>();
  for (const row of Array.isArray(raw) ? raw : []) {
    const reference = LaunchProfileArtifactReferenceV1Schema.safeParse(row);
    if (reference.success) ids.add(reference.data.artifactId);
  }
  if (store.list) {
    let cursor: string | undefined;
    do {
      signal?.throwIfAborted();
      // FIN's Artifact list owns the 500-row page boundary (not a collection cap).
      const page = await store.list({ limit: 500, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}) });
      for (const item of page.items) {
        if (item.header.kind === 'launch-profile.v1' && ['view', 'edit', 'admin'].includes(item.access ?? '')) ids.add(item.artifactId);
      }
      if (page.nextCursor !== undefined && page.nextCursor === cursor) throw Object.assign(new Error('artifact_list_cursor_invalid'), { code: 'artifact_list_cursor_invalid' });
      cursor = page.nextCursor;
    } while (cursor);
  }
  const artifacts = new Map<string, ArtifactSharingResourceV1>();
  for (const id of ids) {
    signal?.throwIfAborted();
    const artifact = await store.read(id, signal ? { signal } : undefined);
    signal?.throwIfAborted();
    if (artifact?.artifactId === id) artifacts.set(id, artifact);
  }
  return artifacts;
}

function readOwnStringId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = Reflect.get(raw, 'id');
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Fail-safe UI pruning predicate. Migration completion is intentionally not a
 * deletion signal here: the daemon's whole-account CAS transform owns removal
 * of migrated bindings in the same atomic write as the provider connection.
 */
export function shouldPreserveLegacyAiLaunchProfileBindingV1(input: Readonly<{
  profileId: string;
  collection: AiLaunchProfileCollectionReadResult;
  migration?: ProviderSettingsMigrationStateV1 | null;
}>): boolean {
  if (LEGACY_AI_LAUNCH_BUILT_IN_PROFILE_IDS_V1.has(input.profileId)) return true;
  if (input.migration?.pendingCustomProfileIds.includes(input.profileId)) return true;
  return input.collection.entries.some((entry) => readOwnStringId(entry.raw) === input.profileId);
}
