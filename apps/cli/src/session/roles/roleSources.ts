import {
  BUILT_IN_ROLES_V1, ArtifactCallerAccessV1Schema, RoleArtifactV1Schema, readLegacyRolesV1,
  type PluginRoleContributionV1, type RoleActionEntryV1,
} from '@happier-dev/protocol';
import type { createAccountArtifactStore } from '@/api/artifacts/accountArtifactStore';
import { readPluginRoleSources } from '@/plugins/projection/registry/roles';
import { readCurrentContributionRegistry } from '@/agent/catalog/snapshot';

export type RoleSourceReaderParams = Readonly<{
  artifactStore?: ReturnType<typeof createAccountArtifactStore>;
  readPluginRoles?: () => readonly PluginRoleContributionV1[];
  accountId?: string;
  readRawAccountSettings?: () => Promise<Readonly<Record<string, unknown>>>;
}>;
export type RoleSourceReader = (signal?: AbortSignal) => Promise<RoleActionEntryV1[]>;

/** One source reader for Action, prompt and permission role resolution. */
export function createRoleSourceReader(params: RoleSourceReaderParams): RoleSourceReader {
  const readPluginRoles = params.readPluginRoles ?? (() => readPluginRoleSources(readCurrentContributionRegistry()));
  return async (signal) => {
    signal?.throwIfAborted();
    const entries: RoleActionEntryV1[] = Object.entries(BUILT_IN_ROLES_V1).map(([roleId, role]) => ({
      roleId, role, shared: false, viewOnly: false, migratedFromV0_2: false,
    }));
    for (const entry of readPluginRoles()) entries.push({
      roleId: `plugin:${entry.pluginId}/${entry.localId}`, role: entry.role,
      shared: false, viewOnly: true, migratedFromV0_2: false,
    });
    if (params.artifactStore) {
      let cursor: string | undefined;
      do {
        // The Artifact list owner's maximum page is 500; consume every page.
        const page = await params.artifactStore.list({ limit: 500, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}) });
        for (const header of page.items) {
          if (header.header.kind !== 'role.v1') continue;
          const artifact = await params.artifactStore.read(header.artifactId, signal ? { signal } : undefined);
          if (!artifact?.body) throw Object.assign(new Error('artifact_content_unavailable'), { code: 'artifact_content_unavailable' });
          let content: unknown;
          try { content = JSON.parse(artifact.body); } catch {
            throw Object.assign(new Error('artifact_content_unavailable'), { code: 'artifact_content_unavailable' });
          }
          const role = RoleArtifactV1Schema.safeParse(content);
          if (!role.success) throw Object.assign(new Error('artifact_content_unavailable'), { code: 'artifact_content_unavailable' });
          const access = ArtifactCallerAccessV1Schema.parse(header.access);
          entries.push({ roleId: artifact.artifactId, role: role.data, revision: artifact.revision,
            shared: access !== 'owner', viewOnly: access === 'view', migratedFromV0_2: artifact.header.migratedFromV0_2 === true });
        }
        if (page.nextCursor === cursor && page.nextCursor !== undefined) {
          throw Object.assign(new Error('artifact_list_cursor_invalid'), { code: 'artifact_list_cursor_invalid' });
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    if (params.accountId && params.readRawAccountSettings) {
      for (const entry of readLegacyRolesV1(await params.readRawAccountSettings(), params.accountId)) {
        if (!entries.some((item) => item.roleId === entry.artifactId)) entries.push({
          roleId: entry.artifactId, role: entry.role, shared: false, viewOnly: false, migratedFromV0_2: true,
        });
      }
    }
    return entries;
  };
}
