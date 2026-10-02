/** Final HostAccess Session scopes, stamped by the host's selection owner. */
export type PluginSessionAccess = 'read' | 'write' | 'control';
export type PluginSessionAccessScope = Readonly<{
  access: readonly PluginSessionAccess[];
  machineIds?: readonly string[];
  projectIds?: readonly string[];
  /** Only exact-current host bindings populate this field, never manifests. */
  sessionIds?: readonly string[];
}>;

/** Inventory and media reads use the same authenticated row facts before metadata fallbacks. */
export function projectPluginSessionAccessIdentity(
  raw: Readonly<{ id: string; machineId?: unknown; projectId?: unknown }>,
  metadata: Readonly<Record<string, unknown>> | null,
): Readonly<{ id: string; machineId?: string; projectId?: string }> {
  const read = (value: unknown) => typeof value === 'string' ? value.trim() || undefined : undefined;
  const machineId = read(raw.machineId) ?? read(metadata?.machineId);
  const projectId = read(raw.projectId) ?? read(metadata?.projectId);
  return { id: raw.id, ...(machineId ? { machineId } : {}), ...(projectId ? { projectId } : {}) };
}

/** Shared Session authorization; client reachability does not confer plugin access. */
export function hasPluginSessionAccess(input: Readonly<{
  scopes: readonly PluginSessionAccessScope[];
  session: Readonly<{ id: string; machineId?: string; projectId?: string }>;
  access: PluginSessionAccess;
}>): boolean {
  return input.scopes.some((scope) => scope.access.includes(input.access)
    && (!scope.sessionIds || scope.sessionIds.includes(input.session.id))
    && (!scope.machineIds || (input.session.machineId !== undefined && scope.machineIds.includes(input.session.machineId)))
    && (!scope.projectIds || (input.session.projectId !== undefined && scope.projectIds.includes(input.session.projectId))));
}
