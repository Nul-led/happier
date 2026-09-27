import { z } from 'zod';

import {
  AcpBackendDefinitionV1Schema,
  AcpCatalogSettingsV1Schema,
  type AcpBackendDefinitionV1,
  type AcpCatalogSettingsV1,
} from './settingsV1.js';

/**
 * The one writer of the Account's custom ACP catalog (`acpCatalogSettingsV1`). The Settings editor
 * and the `agents.acp.backends.*` actions both apply their changes through these functions, so a
 * backend authored by hand and one authored by an agent are validated and stored identically.
 * Persistence (the Account settings writer, its encryption mode and compare-and-set) stays with
 * each caller's existing settings owner.
 */

/** The stored catalog, or an empty one when the stored value is missing or unreadable. */
export function normalizeAcpCatalogSettingsV1(raw: unknown): AcpCatalogSettingsV1 {
  const parsed = AcpCatalogSettingsV1Schema.safeParse(raw);
  return parsed.success ? parsed.data : { v: 2, backends: [] };
}

/**
 * An authored backend: the stored definition, with timestamps optional (they are stamped on
 * write). Loosely typed at the boundary because text fields are trimmed before validation.
 */
export const AcpBackendAuthoringInputV1Schema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: AcpBackendDefinitionV1Schema.shape.env.optional(),
  auth: z.object({
    support: z.string(),
    machineLoginKey: z.string().optional(),
    docsUrl: z.string().optional(),
    loginCommand: z.object({ command: z.string(), args: z.array(z.string()).optional() }).optional(),
    envVars: z.array(z.string()).optional(),
  }).optional(),
  defaultMode: z.string().optional(),
  defaultModel: z.string().optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
}).passthrough();
export type AcpBackendAuthoringInputV1 = z.input<typeof AcpBackendAuthoringInputV1Schema>;

export type AcpCatalogMutationErrorCodeV1 =
  | 'acp_backend_invalid'
  | 'acp_backend_name_conflict'
  | 'acp_backend_id_conflict'
  | 'acp_backend_not_found';

/**
 * A refused write names the authored fields at fault (`id`, `title`, `command`, `env`,
 * `auth.docsUrl`, …) so an editor can show each error beside its field.
 */
export type AcpBackendUpsertResultV1 =
  | Readonly<{ ok: true; settings: AcpCatalogSettingsV1; backend: AcpBackendDefinitionV1 }>
  | Readonly<{ ok: false; code: 'acp_backend_invalid'; message: string; fields: readonly string[] }>
  | Readonly<{ ok: false; code: 'acp_backend_name_conflict'; message: string; fields: readonly ['name'] }>
  | Readonly<{ ok: false; code: 'acp_backend_id_conflict'; message: string; fields: readonly ['id'] }>;

export type AcpBackendDeleteResultV1 =
  | Readonly<{ ok: true; settings: AcpCatalogSettingsV1 }>
  | Readonly<{ ok: false; code: 'acp_backend_not_found' }>;

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The authored field an issue belongs to: `id`, `auth.docsUrl`, or `env` for any variable. */
function resolveIssueField(path: readonly PropertyKey[]): string {
  const [head, next] = path;
  if (head === 'auth' && typeof next === 'string') return `auth.${next}`;
  return String(head ?? '');
}

/**
 * Adds a backend or replaces the one with the same id; names stay unique across the catalog.
 * `create` refuses an id that is already taken, so a new backend never silently replaces one.
 */
export function applyAcpBackendUpsertV1(input: Readonly<{
  settings: unknown;
  backend: AcpBackendAuthoringInputV1;
  nowMs: number;
  mode?: 'upsert' | 'create';
}>): AcpBackendUpsertResultV1 {
  const settings = normalizeAcpCatalogSettingsV1(input.settings);
  const authored = input.backend;
  const id = authored.id.trim();
  const previous = settings.backends.find((entry) => entry.id === id) ?? null;
  if (previous && input.mode === 'create') {
    return { ok: false, code: 'acp_backend_id_conflict', message: `Duplicate ACP backend id: ${id}`, fields: ['id'] };
  }
  const parsed = AcpBackendDefinitionV1Schema.safeParse({
    ...authored,
    id,
    name: authored.name.trim(),
    title: authored.title.trim(),
    description: trimmedOrUndefined(authored.description),
    command: authored.command.trim(),
    auth: authored.auth
      ? {
        ...authored.auth,
        machineLoginKey: trimmedOrUndefined(authored.auth.machineLoginKey),
        docsUrl: trimmedOrUndefined(authored.auth.docsUrl),
        loginCommand: authored.auth.loginCommand?.command?.trim()
          ? { command: authored.auth.loginCommand.command.trim(), args: authored.auth.loginCommand.args }
          : undefined,
      }
      : undefined,
    createdAt: authored.createdAt ?? previous?.createdAt ?? input.nowMs,
    updatedAt: authored.updatedAt ?? input.nowMs,
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: 'acp_backend_invalid',
      message: parsed.error.issues[0]?.message ?? 'Invalid ACP backend',
      fields: [...new Set(parsed.error.issues.map((issue) => resolveIssueField(issue.path)))],
    };
  }
  const backend = parsed.data;
  if (settings.backends.some((entry) => entry.id !== backend.id && entry.name === backend.name)) {
    return { ok: false, code: 'acp_backend_name_conflict', message: `Duplicate ACP backend name: ${backend.name}`, fields: ['name'] };
  }
  const backends = previous
    ? settings.backends.map((entry) => (entry.id === backend.id ? backend : entry))
    : [...settings.backends, backend];
  return { ok: true, settings: { ...settings, backends }, backend };
}

/**
 * An id (and name) for a backend from its display name: lower-case words joined by `-`, accents
 * dropped, suffixed `-2`, `-3`, … until no stored backend uses it as an id or a name. Empty when the
 * display name has no letters or digits to derive from, so the author types one.
 */
export function suggestAcpBackendIdV1(input: Readonly<{ title: string; settings: unknown }>): string {
  const base = input.title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '');
  if (!base) return '';
  const taken = new Set(normalizeAcpCatalogSettingsV1(input.settings).backends.flatMap((entry) => [entry.id, entry.name]));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Removes the backend with this id. */
export function applyAcpBackendDeleteV1(input: Readonly<{
  settings: unknown;
  backendId: string;
}>): AcpBackendDeleteResultV1 {
  const settings = normalizeAcpCatalogSettingsV1(input.settings);
  const backendId = input.backendId.trim();
  if (!settings.backends.some((entry) => entry.id === backendId)) return { ok: false, code: 'acp_backend_not_found' };
  return { ok: true, settings: { ...settings, backends: settings.backends.filter((entry) => entry.id !== backendId) } };
}

/** `agents.acp.backends.upsert`: add or replace one custom ACP agent in the Account catalog. */
export const AgentsAcpBackendsUpsertInputV1Schema = z.object({
  backend: AcpBackendAuthoringInputV1Schema,
}).strict();
export type AgentsAcpBackendsUpsertInputV1 = z.infer<typeof AgentsAcpBackendsUpsertInputV1Schema>;
export const AgentsAcpBackendsUpsertOutputV1Schema = z.object({
  backend: AcpBackendDefinitionV1Schema,
}).strict();

/** `agents.acp.backends.delete`: remove one custom ACP agent from the Account catalog. */
export const AgentsAcpBackendsDeleteInputV1Schema = z.object({
  backendId: z.string().trim().min(1),
}).strict();
export type AgentsAcpBackendsDeleteInputV1 = z.infer<typeof AgentsAcpBackendsDeleteInputV1Schema>;
export const AgentsAcpBackendsDeleteOutputV1Schema = z.object({
  backendId: z.string(),
  deleted: z.literal(true),
}).strict();
