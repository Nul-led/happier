import {
  normalizeStrictJsonValue,
  type JsonValue,
} from '../json/strictJsonValue.js';

function canonicalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, JsonValue>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalizeJsonValue(record[key]!)] as const),
    );
  }
  return value;
}

export function createCanonicalJsonSigningInput(value: unknown): string {
  const serialized = JSON.stringify(canonicalizeJsonValue(normalizeStrictJsonValue(value)));
  if (typeof serialized !== 'string') {
    throw new TypeError('Canonical JSON serialization did not produce a string');
  }
  return serialized;
}
