import { redactHarnessLogText } from './process/harnessLogRedaction';

export const REDACTED_SECRET_PLACEHOLDER = '__redacted_secret__';

export class CredentialShapedArtifactFieldError extends Error {
  constructor(readonly fieldPath: string) {
    super(`Credential-shaped artifact field is forbidden: ${fieldPath}`);
    this.name = 'CredentialShapedArtifactFieldError';
  }
}

const minimumRegisteredSecretLength = 12;
const registeredRuntimeSecretValues = new Set<string>();

function credentialKeyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

export function isCredentialShapedKey(key: string): boolean {
  const tokens = credentialKeyTokens(key);
  const has = (token: string): boolean => tokens.includes(token);
  if (has('fingerprint') || has('fingerprints') || has('public')) {
    return false;
  }
  const isCredentialMetadata = [
    'kind',
    'type',
    'mode',
    'status',
    'count',
    'id',
    'ids',
    'target',
    'source',
    'scope',
    'reason',
    'code',
    'expiry',
    'expires',
    'ttl',
  ].some(has);
  if (isCredentialMetadata && !has('secret') && !has('password') && !has('passphrase')) {
    return false;
  }
  return has('credential')
    || has('credentials')
    || has('authorization')
    || has('password')
    || has('passphrase')
    || has('secret')
    || has('token')
    || has('seed')
    || (has('private') && has('key'))
    || (has('access') && has('key'))
    || (has('api') && has('key'));
}

export function registerRuntimeSecretValues(...values: readonly string[]): void {
  for (const value of values) {
    if (value.length >= minimumRegisteredSecretLength) {
      registeredRuntimeSecretValues.add(value);
    }
  }
}

export function clearRegisteredRuntimeSecretValues(): void {
  registeredRuntimeSecretValues.clear();
}

export function scrubKnownSecretValues(value: string): string {
  let scrubbed = value;
  const secrets = [...registeredRuntimeSecretValues].sort((a, b) => b.length - a.length);
  for (const secret of secrets) {
    scrubbed = scrubbed.split(secret).join(REDACTED_SECRET_PLACEHOLDER);
  }
  return scrubbed;
}

export function scrubKnownSecretValuesDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return scrubKnownSecretValues(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubKnownSecretValuesDeep(entry)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, scrubKnownSecretValuesDeep(entry)]),
    ) as T;
  }
  return value;
}

/** Preserves structured JSON while redacting registered and recognizable free-form credentials. */
export function redactArtifactTextValuesDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return redactHarnessLogText(scrubKnownSecretValues(value)) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactArtifactTextValuesDeep(entry)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactArtifactTextValuesDeep(entry)]),
    ) as T;
  }
  return value;
}

export function redactCredentialShapedValuesDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactCredentialShapedValuesDeep(entry)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === 'string' && isCredentialShapedKey(key)
        ? REDACTED_SECRET_PLACEHOLDER
        : redactCredentialShapedValuesDeep(entry),
    ])) as T;
  }
  return value;
}

export function findCredentialShapedValuePath(
  value: unknown,
  path: readonly string[] = [],
): string | null {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findCredentialShapedValuePath(entry, [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const entryPath = [...path, key];
      if (isCredentialShapedKey(key)) {
        if (entry && typeof entry === 'object') {
          const nested = findCredentialShapedValuePath(entry, entryPath);
          return nested ?? entryPath.join('.');
        }
        if (entry !== undefined && typeof entry !== 'number' && typeof entry !== 'boolean') {
          return entryPath.join('.');
        }
        continue;
      }
      const nested = findCredentialShapedValuePath(entry, entryPath);
      if (nested) return nested;
    }
  }
  return null;
}

export function redactCredentialShapedRecord(
  record: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    value !== undefined && isCredentialShapedKey(key)
      ? REDACTED_SECRET_PLACEHOLDER
      : value === undefined
        ? undefined
        : scrubKnownSecretValues(value),
  ]));
}
