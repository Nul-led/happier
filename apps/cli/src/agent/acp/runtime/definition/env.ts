export function withAcpLaunchEnvDefaults(
  env: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  return Object.freeze({
    ...(env ?? {}),
    NODE_ENV: env?.NODE_ENV ?? 'production',
    DEBUG: env?.DEBUG ?? '',
  });
}
