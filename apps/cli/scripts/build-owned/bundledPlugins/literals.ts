/** Pure projection rendering; filesystem, preparation and publication stay in the generator. */
import type {
  JsonObject,
  JsonValue,
  PluginManifestJson,
} from './projectionFacts.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepSortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => deepSortJson(entry)) as JsonValue;
  }
  if (value === null || typeof value !== 'object') return value;

  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of entries) {
    out[k] = deepSortJson(v);
  }
  return out;
}

export function renderJsonLiteral(value: JsonValue, indent = 2): string {
  return JSON.stringify(deepSortJson(value), null, indent) ?? 'null';
}

/**
 * Locator manifests are consumed as canonical data at daemon cold start. Keep
 * their generated representation compact: pretty-printing every nested
 * manifest inflated this one projection from 1,208 to more than 169,000 lines
 * without changing the serialized data or its ingestion owner.
 */
export function renderCompactJsonLiteral(value: JsonValue): string {
  return JSON.stringify(deepSortJson(value)) ?? 'null';
}

export function readManifestContributionArray(manifest: PluginManifestJson, family: string): readonly JsonValue[] {
  const contributes = manifest.contributes;
  if (!isRecord(contributes)) return [];
  const value = contributes[family];
  return Array.isArray(value) ? value : [];
}

export function readRequiredContributionId(value: JsonValue, family: string, pluginPackageId: string): string {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim().length === 0) {
    throw new Error(`Invalid ${family} contribution in ${pluginPackageId}: expected object with non-empty string id`);
  }
  return value.id;
}

export function readOptionalJsonStringProperty(value: JsonValue, key: string): string | null {
  if (!isJsonObject(value)) return null;
  const property = value[key];
  return typeof property === 'string' && property.trim().length > 0 ? property : null;
}

export function readJsonObjectProperty(value: JsonValue, key: string): JsonObject | null {
  if (!isJsonObject(value)) return null;
  const property = value[key];
  return isJsonObject(property) ? property : null;
}

export function readJsonArrayProperty(value: JsonValue, key: string): readonly JsonValue[] {
  if (!isJsonObject(value)) return [];
  const property = value[key];
  return Array.isArray(property) ? property : [];
}

export function readRequiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid agent UI descriptor at ${path}: expected object`);
  }
  return value;
}

export function readRequiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid agent UI descriptor at ${path}.${key}: expected non-empty string`);
  }
  return value;
}

export function manifestDeclaresDaemonEntrypoint(manifest: JsonValue): boolean {
  const entrypoints = readJsonObjectProperty(manifest, 'entrypoints');
  return typeof entrypoints?.daemon === 'string' && entrypoints.daemon.trim().length > 0;
}

export function renderTsStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

function renderTsImportSpecifier(source: string): string {
  const normalized = source.replaceAll('\\', '/').trim();
  if (!normalized) {
    throw new Error('Invalid generated import source: expected non-empty string');
  }
  if (!normalized.startsWith('.') && !normalized.startsWith('/')) {
    return normalized;
  }
  return /\.(?:mjs|cjs|jsx?|tsx?)$/.test(normalized) ? normalized.replace(/\.(?:tsx?|jsx?)$/, '.js') : `${normalized}.js`;
}

export function renderTsNullableStringLiteral(value: string | null): string {
  return value === null ? 'null' : renderTsStringLiteral(value);
}

export function renderTsStringArrayLiteral(values: readonly string[]): string {
  return `[${values.map((value) => renderTsStringLiteral(value)).join(', ')}]`;
}
