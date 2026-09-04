export type ExecutionRunBackendStartContext = Readonly<{
  intentInput?: unknown;
  retentionPolicy?: string;
  intent?: string;
  profileId?: string;
}>;

export type ExecutionRunBackendIsolation = Readonly<{
  env?: Record<string, string>;
  unsetEnvKeys?: readonly string[];
  settingsPath?: string;
}>;
