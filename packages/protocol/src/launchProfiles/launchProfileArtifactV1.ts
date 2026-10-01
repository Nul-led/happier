import { z } from 'zod';
import type { ArtifactSharingKindAdapterV1, ArtifactSharingResourceV1 } from '../artifacts/artifactSharingV1.js';
import { parseSavedSecretRefV1 } from '../account/settings/savedSecretReferenceV1.js';
import { isCanonicalProviderSavedSecretIdV1 } from '../providers/settings/v1.js';
import { AIBackendProfileSchema } from '../profiles/backendProfileSchema.js';
import { EnvVarRequirementSchema } from '../profiles/environmentVariables.js';
import { LaunchProfileV2Schema } from '../profiles/v2/schema.js';

// Inline legacy readers intentionally strip unknown fields. A new shared document
// must instead refuse them, including unknown fields nested inside environment rows.
function retainsAllKeys(raw: unknown, parsed: unknown, path = ''): boolean {
  if (!raw || typeof raw !== 'object') return true;
  if (!parsed || typeof parsed !== 'object') return false;
  // These are typed records, not strip-unknown objects. Their canonical schemas
  // normalize predecessor target keys; a renamed record key is not a discarded field.
  if (path === 'defaultPermissionModeByTargetKey' || path === 'defaultPersistenceModeByTargetKey'
    || path === 'compatibilityByTargetKey') return true;
  return Object.keys(raw).every((key) => Object.prototype.hasOwnProperty.call(parsed, key)
    && retainsAllKeys(Reflect.get(raw, key), Reflect.get(parsed, key), path ? `${path}.${key}` : key));
}

export const PublishableLaunchProfileV1Schema = z.unknown().transform((raw, ctx) => {
  const version = raw && typeof raw === 'object' ? Reflect.get(raw, 'v') : undefined;
  const parsed = version === undefined ? AIBackendProfileSchema.safeParse(raw) : LaunchProfileV2Schema.safeParse(raw);
  if (!parsed.success || !retainsAllKeys(raw, parsed.data)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid or unknown launch profile fields' });
    return z.NEVER;
  }
  return parsed.data;
});

export const LaunchProfileArtifactV1Schema = z.object({
  kind: z.literal('launch-profile.v1'),
  profile: PublishableLaunchProfileV1Schema,
  secretBindings: z.record(EnvVarRequirementSchema.shape.name, z.string().refine((ref) => {
    if (!isCanonicalProviderSavedSecretIdV1(ref)) return false;
    try { parseSavedSecretRefV1(ref); return true; } catch { return false; }
  })).default({}),
}).strict().superRefine((content, ctx) => {
  const variables = 'v' in content.profile ? content.profile.extraEnvironmentVariables : content.profile.environmentVariables;
  if (variables.length > 0) ctx.addIssue({ code: 'custom', path: ['profile'], message: 'Shared launch profiles carry requirements, never environment values' });
});
export type LaunchProfileArtifactV1 = z.infer<typeof LaunchProfileArtifactV1Schema>;
export type SharedLaunchProfileArtifactV1 = Readonly<LaunchProfileArtifactV1 & {
  artifactId: string;
  revision: Readonly<{ headerVersion: number; bodyVersion: number }>;
  shared: true;
  viewOnly: boolean;
}>;

export const LaunchProfileArtifactReferenceV1Schema = z.object({ artifactId: z.string().min(1) }).strict();

export function readLaunchProfileArtifactV1(resource: ArtifactSharingResourceV1): LaunchProfileArtifactV1 | null {
  if (resource.header.kind !== 'launch-profile.v1' || typeof resource.body !== 'string') return null;
  try {
    const parsed = LaunchProfileArtifactV1Schema.safeParse(JSON.parse(resource.body));
    if (!parsed.success || parsed.data.profile.id !== resource.header.profileId || parsed.data.profile.name !== resource.header.name) return null;
    return parsed.data;
  } catch { return null; }
}

export const launchProfileArtifactSharingAdapterV1 = {
  kind: 'launch-profile.v1',
  canShare: (resource: ArtifactSharingResourceV1) => readLaunchProfileArtifactV1(resource) !== null,
} as const satisfies ArtifactSharingKindAdapterV1;

/** FIN's opened, authorized grant results are the only source of recipient rows. */
export function listSharedLaunchProfileArtifactsV1(resources: readonly ArtifactSharingResourceV1[]): SharedLaunchProfileArtifactV1[] {
  return resources.flatMap((resource) => {
    if (resource.access !== 'view' && resource.access !== 'edit' && resource.access !== 'admin') return [];
    const content = readLaunchProfileArtifactV1(resource);
    if (!content || !resource.revision) return [];
    return [{ artifactId: resource.artifactId, ...content, revision: resource.revision, shared: true as const, viewOnly: resource.access === 'view' }];
  });
}
