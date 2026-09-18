/**
 * Environment variables whose values are owned by the Runner's protected,
 * activation-local process environment. Creator-reviewed Profile values may
 * not replace them, including through case variants on Windows.
 *
 * Keep this set aligned with the activation-local directories established by
 * the CLI local-state owner. PATH and locale variables are deliberately absent:
 * they remain portable reviewed authoring inputs.
 */
export const RUNNER_ISOLATION_ENVIRONMENT_KEYS_V1 = Object.freeze([
  'HAPPIER_HOME_DIR',
  'HOME',
  'USERPROFILE',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'TEMP',
  'TMP',
  'TMPDIR',
] as const);

export type RunnerIsolationEnvironmentKeyV1 =
  (typeof RUNNER_ISOLATION_ENVIRONMENT_KEYS_V1)[number];

const RUNNER_ISOLATION_ENVIRONMENT_KEY_IDENTITIES_V1 = new Set<string>(
  RUNNER_ISOLATION_ENVIRONMENT_KEYS_V1,
);

export function isRunnerIsolationEnvironmentKeyV1(key: string): boolean {
  return RUNNER_ISOLATION_ENVIRONMENT_KEY_IDENTITIES_V1.has(key.toUpperCase());
}

/**
 * Defense in depth for runtime callers consuming already-reviewed manifests.
 * Preactivation authoring rejects these keys; this projection prevents an old
 * or malformed caller from replacing the Runner's local isolation values.
 */
export function filterRunnerReviewedEnvironmentVariablesV1(
  environmentVariables: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(environmentVariables).filter(
      ([key]) => !isRunnerIsolationEnvironmentKeyV1(key),
    ),
  ));
}
