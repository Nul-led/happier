export type PersonalHomeRestorableConfigurationV1 = Readonly<{
  homeServerIdentityId: string;
  canonicalServerUrl?: string;
  encryptionStoragePolicy: 'plaintext_only';
  defaultAccountMode: 'plain';
  plainAccountSettingsAtRest: 'none' | 'server_sealed';
  plainAccountCredentialsAtRest: 'none' | 'server_sealed';
  plainAccountArtifactsAtRest: 'none' | 'server_sealed';
  anonymousSignupPhase: 'loopback-bootstrap-then-disabled';
}>;

export const PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS = Object.freeze({
  canonicalServerUrl: 'HAPPIER_CANONICAL_SERVER_URL',
  encryptionStoragePolicy: 'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY',
  defaultAccountMode: 'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE',
  plainAccountSettingsAtRest: 'HAPPIER_FEATURE_ENCRYPTION__PLAIN_ACCOUNT_SETTINGS_AT_REST',
  plainAccountCredentialsAtRest: 'HAPPIER_FEATURE_ENCRYPTION__PLAIN_ACCOUNT_CREDENTIALS_AT_REST',
  plainAccountArtifactsAtRest: 'HAPPIER_FEATURE_ENCRYPTION__PLAIN_ACCOUNT_ARTIFACTS_AT_REST',
  anonymousSignupPhase: 'AUTH_ANONYMOUS_SIGNUP_ENABLED',
} as const);

const REQUIRED_FIELDS = Object.freeze([
  'homeServerIdentityId',
  'encryptionStoragePolicy',
  'defaultAccountMode',
  'plainAccountSettingsAtRest',
  'plainAccountCredentialsAtRest',
  'plainAccountArtifactsAtRest',
  'anonymousSignupPhase',
] as const);
const OPTIONAL_FIELDS = Object.freeze(['canonicalServerUrl'] as const);
const ALLOWED_FIELDS = new Set<string>([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);

function normalizeCanonicalServerUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('Invalid Personal Home canonical server URL configuration');
  }
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid Personal Home canonical server URL configuration');
  }
  return value.replace(/\/+$/u, '');
}

function assertSealingPolicy(value: unknown, field: string): asserts value is 'none' | 'server_sealed' {
  if (value !== 'none' && value !== 'server_sealed') {
    throw new Error(`Invalid Personal Home ${field} configuration`);
  }
}

export function parsePersonalHomeRestorableConfigurationV1(value: unknown): PersonalHomeRestorableConfigurationV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Personal Home configuration artifact');
  }
  const configuration = value as Record<string, unknown>;
  for (const key of Object.keys(configuration)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unknown Personal Home configuration field: ${key}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in configuration)) throw new Error(`Missing Personal Home configuration field: ${field}`);
  }
  if (typeof configuration.homeServerIdentityId !== 'string' || configuration.homeServerIdentityId.length === 0) {
    throw new Error('Invalid Personal Home identity configuration');
  }
  if (configuration.encryptionStoragePolicy !== 'plaintext_only') throw new Error('Invalid Personal Home storage policy configuration');
  if (configuration.defaultAccountMode !== 'plain') throw new Error('Invalid Personal Home account mode configuration');
  assertSealingPolicy(configuration.plainAccountSettingsAtRest, 'settings-at-rest policy');
  assertSealingPolicy(configuration.plainAccountCredentialsAtRest, 'credentials-at-rest policy');
  assertSealingPolicy(configuration.plainAccountArtifactsAtRest, 'artifacts-at-rest policy');
  if (configuration.anonymousSignupPhase !== 'loopback-bootstrap-then-disabled') {
    throw new Error('Invalid Personal Home anonymous signup phase');
  }
  const canonicalServerUrl = normalizeCanonicalServerUrl(configuration.canonicalServerUrl);
  return Object.freeze({
    homeServerIdentityId: configuration.homeServerIdentityId,
    ...(canonicalServerUrl === undefined ? {} : { canonicalServerUrl }),
    encryptionStoragePolicy: 'plaintext_only',
    defaultAccountMode: 'plain',
    plainAccountSettingsAtRest: configuration.plainAccountSettingsAtRest,
    plainAccountCredentialsAtRest: configuration.plainAccountCredentialsAtRest,
    plainAccountArtifactsAtRest: configuration.plainAccountArtifactsAtRest,
    anonymousSignupPhase: 'loopback-bootstrap-then-disabled',
  });
}

export function normalizePersonalHomeRestorableConfigurationV1(
  source: Readonly<Record<string, unknown>>,
  homeServerIdentityId: string,
): PersonalHomeRestorableConfigurationV1 {
  let canonicalServerUrl: string | undefined;
  try {
    canonicalServerUrl = normalizeCanonicalServerUrl(source.canonicalServerUrl);
  } catch {
    // A malformed runtime origin is not restorable configuration. Preserve backup availability;
    // the destination runtime owner keeps/regenerates its canonical origin instead.
    canonicalServerUrl = undefined;
  }
  return parsePersonalHomeRestorableConfigurationV1({
    homeServerIdentityId,
    ...(canonicalServerUrl === undefined ? {} : { canonicalServerUrl }),
    encryptionStoragePolicy: 'plaintext_only',
    defaultAccountMode: 'plain',
    plainAccountSettingsAtRest: source.plainAccountSettingsAtRest === 'none' ? 'none' : 'server_sealed',
    plainAccountCredentialsAtRest: source.plainAccountCredentialsAtRest === 'none' ? 'none' : 'server_sealed',
    plainAccountArtifactsAtRest: source.plainAccountArtifactsAtRest === 'none' ? 'none' : 'server_sealed',
    anonymousSignupPhase: 'loopback-bootstrap-then-disabled',
  });
}

export function parsePersonalHomeRestorableConfigurationJsonV1(
  value: string,
  expectedHomeServerIdentityId: string,
): PersonalHomeRestorableConfigurationV1 {
  const configuration = parsePersonalHomeRestorableConfigurationV1(JSON.parse(value) as unknown);
  if (configuration.homeServerIdentityId !== expectedHomeServerIdentityId) {
    throw new Error('Personal Home configuration identity does not match the backup manifest');
  }
  return configuration;
}

export function serializePersonalHomeRestorableConfigurationV1(configuration: PersonalHomeRestorableConfigurationV1): string {
  return `${JSON.stringify(parsePersonalHomeRestorableConfigurationV1(configuration), null, 2)}\n`;
}

export function personalHomeRestorableConfigurationEnvOverrides(
  configuration: PersonalHomeRestorableConfigurationV1,
): Readonly<Record<string, string>> {
  const validated = parsePersonalHomeRestorableConfigurationV1(configuration);
  return Object.freeze({
    ...(validated.canonicalServerUrl === undefined ? {} : {
      [PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS.canonicalServerUrl]: validated.canonicalServerUrl,
    }),
    [PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS.encryptionStoragePolicy]: validated.encryptionStoragePolicy,
    [PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS.defaultAccountMode]: validated.defaultAccountMode,
    [PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS.plainAccountSettingsAtRest]: validated.plainAccountSettingsAtRest,
    [PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS.plainAccountCredentialsAtRest]: validated.plainAccountCredentialsAtRest,
    [PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS.plainAccountArtifactsAtRest]: validated.plainAccountArtifactsAtRest,
    [PERSONAL_HOME_RESTORABLE_CONFIGURATION_ENV_KEYS.anonymousSignupPhase]: '0',
  });
}
