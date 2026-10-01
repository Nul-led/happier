import { RoleArtifactV1Schema, RoleEngineV1Schema, RoleRunsAsV1Schema, type RoleArtifactV1 } from '../../prompts/roles/roleArtifactV1.js';
import { BackendTargetRefV2InputSchema, buildBackendTargetKeyV2, readBackendTargetRefV2 } from '../../backends/targets/backendTargetRefV2.js';
import { computeCanonicalDomainSeparatedHexDigest } from '../../crypto/canonicalDigest.js';
import { RolesV1Schema, type RolesV1 } from './rolesV1.js';

export type LegacyRoleArtifactV1 = Readonly<{ artifactId: string; role: RoleArtifactV1 }>;

export function readLegacyRolesV1(rawSettings: Readonly<Record<string, unknown>>, accountId: string): readonly LegacyRoleArtifactV1[] {
  if (Object.hasOwn(rawSettings, 'rolesV1') || !Array.isArray(rawSettings.executionRunsGuidanceEntries)) return [];
  const result: LegacyRoleArtifactV1[] = [];
  for (const candidate of rawSettings.executionRunsGuidanceEntries) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const entry: Record<string, unknown> = candidate;
    if (typeof entry.id !== 'string' || !entry.id || typeof entry.description !== 'string' || !entry.description.trim()) continue;
    const description = entry.description.trim();
    const name = typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim() : description.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? description;
    const intent = RoleRunsAsV1Schema.safeParse({ kind: 'background_run', intent: entry.suggestedIntent });
    const target = BackendTargetRefV2InputSchema.safeParse(entry.suggestedBackendTarget);
    let engine: RoleArtifactV1['engine'];
    if (target.success) {
      try {
        const ref = typeof target.data === 'object' && target.data.kind === 'agent' && 'identity' in target.data
          ? target.data : readBackendTargetRefV2(target.data);
        const parsedEngine = RoleEngineV1Schema.safeParse({
          agentTargetKey: buildBackendTargetKeyV2(ref),
          ...(typeof entry.suggestedModelId === 'string' && entry.suggestedModelId.trim() ? { modelId: entry.suggestedModelId.trim() } : {}),
        });
        if (parsedEngine.success) engine = parsedEngine.data;
      } catch {
        // A legacy target that no longer resolves needs an explicit engine choice.
      }
    }
    const examples = Array.isArray(entry.exampleToolCalls) ? entry.exampleToolCalls.filter((value): value is string => typeof value === 'string') : [];
    const instructions = [description,
      ...(intent.success && intent.data.kind === 'background_run' ? [`Suggested intent: ${intent.data.intent}`] : []),
      ...(!engine ? ['Choose an engine before running this role.'] : []),
      ...(examples.length ? ['Examples', ...examples] : []),
    ].join('\n\n');
    // UUIDv8: Account + the stable predecessor entry id, not mutable role content.
    const hex = computeCanonicalDomainSeparatedHexDigest('happier.role.v1.legacy', [accountId, entry.id]);
    const artifactId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    result.push({ artifactId, role: RoleArtifactV1Schema.parse({
      name, instructions, ...(engine ? { engine } : {}),
      runsAs: intent.success ? intent.data : { kind: 'session' },
      workspaceWrites: 'allow', secondOpinion: 'off',
      enabled: rawSettings.executionRunsGuidanceEnabled !== false && entry.enabled !== false,
    }) });
  }
  return result;
}

/** Artifacts must be retained before the settings root cuts off legacy reads. */
export async function saveRolesV1WithLegacyMigration(params: Readonly<{
  rawSettings: Readonly<Record<string, unknown>>;
  accountId: string;
  rolesV1: RolesV1;
  ensureRoleArtifact: (entry: LegacyRoleArtifactV1) => Promise<void>;
  saveSettings: (roles: RolesV1) => Promise<void>;
}>): Promise<void> {
  const roles = RolesV1Schema.parse(params.rolesV1);
  for (const entry of readLegacyRolesV1(params.rawSettings, params.accountId)) await params.ensureRoleArtifact(entry);
  await params.saveSettings(roles);
}
