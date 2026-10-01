import type { SystemTaskJsonObject } from './spec.js';

export type ReleaseChannelSwitchForSetupPromptData = Readonly<{
  targetReleaseChannel: string;
  currentDefaultReleaseChannel: string | null;
  targetServerUrl: string | null;
  managedReleaseChannels: ReadonlyArray<ManagedReleaseChannelPromptEntry>;
}>;

export type ManagedReleaseChannelPromptEntry = Readonly<{
  releaseChannel: string;
  label: string;
  version: string | null;
  installationId: string;
  installationPath: string;
  invokerName: string;
  isDefault: boolean;
  onPath: boolean;
}>;

export type ReplaceLocalBackgroundServicesPromptData = Readonly<{
  targetReleaseChannel: string | null;
  targetServerUrl: string | null;
  services: ReadonlyArray<BackgroundServicePromptEntryWithServer>;
}>;

export type TakeOverManualRelayRuntimeForSetupPromptData = Readonly<{
  targetReleaseChannel: string | null;
  targetServerUrl: string | null;
  currentReleaseChannel: string | null;
  currentCliVersion: string | null;
}>;

export type ReplaceRemoteBackgroundServicesPromptData = Readonly<{
  targetReleaseChannel: string | null;
  targetServerUrl: string | null;
  services: ReadonlyArray<BackgroundServicePromptEntry>;
}>;

export type BackgroundServicePromptEntry = Readonly<{
  label: string;
  releaseChannel: string | null;
  targetMode: string | null;
  running: boolean;
}>;

export type BackgroundServicePromptEntryWithServer = BackgroundServicePromptEntry & Readonly<{
  serverUrl: string | null;
}>;

/** `managed`: install the managed CLI and put it first. `own`: keep using the user's CLI. */
export type SetupCliChoice = 'managed' | 'own';

export type SetupCliOrigin = 'npm' | 'brew' | 'unknown';

/**
 * `setup.cliChoice` (plan R12): this computer already has a `happier` this app did not install.
 * Asked before setup writes anything, and only when no answer is recorded, the kept CLI
 * disappeared, it cannot serve setup, or Settings asks to reconsider.
 */
export type SetupCliChoicePromptData = Readonly<{
  /** Where that CLI resolves; a local filesystem path. */
  command: string;
  /** What `happier --version` answered; `null` when it answered nothing readable. */
  version: string | null;
  origin: SetupCliOrigin;
  /** The command that removes that copy (shown, never run); `null` when its origin is unknown. */
  removalCommand: string | null;
  /** The command that updates that copy; `null` when its origin is unknown. */
  updateCommand: string | null;
  /** That CLI cannot drive desktop setup yet, so keeping it cannot finish setup until it is updated. */
  belowSetupFloor: boolean;
  /** The CLI this computer kept is no longer at `command`; keeping it means reinstalling it. */
  missing: boolean;
  /**
   * The managed `happier` a new terminal runs first through something Desktop did not create (the
   * official installer's link or `Path` entry), so "Keep my own" cannot work and is not offered.
   * `null` when keeping it works.
   */
  keepBlockedBy: string | null;
}>;

export type SshTrustPromptData = Readonly<{
  kind: 'ssh.trustHost' | 'ssh.replaceHostKey';
  host: string;
  keyType: string | null;
  fingerprint: string;
  existingFingerprint: string | null;
}>;

export type ApproveRemoteProvisioningPromptData = Readonly<{
  publicKey: string | null;
}>;

export type SshPasswordPromptData = Readonly<{
  target: string;
}>;

export type SshPrivateKeyPassphrasePromptData = Readonly<{
  promptId: string;
  host: string;
  port: number;
  username: string;
  keyLabel: string | null;
  attemptsRemaining: number | null;
}>;

export type SshKeyboardInteractivePromptEntry = Readonly<{
  id: string;
  label: string;
  echo: boolean;
}>;

export type SshKeyboardInteractivePromptData = Readonly<{
  promptId: string;
  host: string;
  port: number;
  username: string;
  name: string | null;
  instruction: string | null;
  prompts: ReadonlyArray<SshKeyboardInteractivePromptEntry>;
}>;

function readTrimmedString(record: SystemTaskJsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readPort(record: SystemTaskJsonObject, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535 ? value : 22;
}

function readPositiveInteger(record: SystemTaskJsonObject, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function parseBackgroundServicePromptEntry(
  entry: unknown,
): BackgroundServicePromptEntry | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const item = entry as SystemTaskJsonObject;
  const label = readTrimmedString(item, 'label');
  if (!label) {
    return null;
  }

  return {
    label,
    releaseChannel: readTrimmedString(item, 'releaseChannel'),
    targetMode: readTrimmedString(item, 'targetMode'),
    running: item.running === true,
  };
}

export function parseReleaseChannelSwitchForSetupPromptData(
  record: SystemTaskJsonObject,
): ReleaseChannelSwitchForSetupPromptData | null {
  const targetReleaseChannel = readTrimmedString(record, 'targetReleaseChannel');
  if (!targetReleaseChannel) {
    return null;
  }

  const managedReleaseChannelsRaw = Array.isArray(record.managedReleaseChannels)
    ? record.managedReleaseChannels
    : [];
  const managedReleaseChannels = managedReleaseChannelsRaw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const item = entry as SystemTaskJsonObject;
    const releaseChannel = readTrimmedString(item, 'releaseChannel');
    const label = readTrimmedString(item, 'label');
    const installationId = readTrimmedString(item, 'installationId');
    const installationPath = readTrimmedString(item, 'installationPath');
    const invokerName = readTrimmedString(item, 'invokerName');
    if (!releaseChannel || !label || !installationId || !installationPath || !invokerName) {
      return [];
    }

    return [{
      releaseChannel,
      label,
      version: readTrimmedString(item, 'version'),
      installationId,
      installationPath,
      invokerName,
      isDefault: item.isDefault === true,
      onPath: item.onPath === true,
    } satisfies ManagedReleaseChannelPromptEntry];
  });

  return {
    targetReleaseChannel,
    currentDefaultReleaseChannel: readTrimmedString(record, 'currentDefaultReleaseChannel'),
    targetServerUrl: readTrimmedString(record, 'targetServerUrl'),
    managedReleaseChannels,
  };
}

export function parseReplaceLocalBackgroundServicesPromptData(
  record: SystemTaskJsonObject,
): ReplaceLocalBackgroundServicesPromptData {
  const servicesRaw = Array.isArray(record.services) ? record.services : [];
  const services = servicesRaw.flatMap((entry) => {
    const parsed = parseBackgroundServicePromptEntry(entry);
    if (!parsed) {
      return [];
    }

    const item = entry as SystemTaskJsonObject;
    return [{
      ...parsed,
      serverUrl: readTrimmedString(item, 'serverUrl'),
    } satisfies BackgroundServicePromptEntryWithServer];
  });

  return {
    targetReleaseChannel: readTrimmedString(record, 'targetReleaseChannel'),
    targetServerUrl: readTrimmedString(record, 'targetServerUrl'),
    services,
  };
}

export function parseTakeOverManualRelayRuntimeForSetupPromptData(
  record: SystemTaskJsonObject,
): TakeOverManualRelayRuntimeForSetupPromptData {
  return {
    targetReleaseChannel: readTrimmedString(record, 'targetReleaseChannel'),
    targetServerUrl: readTrimmedString(record, 'targetServerUrl'),
    currentReleaseChannel: readTrimmedString(record, 'currentReleaseChannel'),
    currentCliVersion: readTrimmedString(record, 'currentCliVersion'),
  };
}

export function parseReplaceRemoteBackgroundServicesPromptData(
  record: SystemTaskJsonObject,
): ReplaceRemoteBackgroundServicesPromptData {
  const servicesRaw = Array.isArray(record.services) ? record.services : [];
  const services = servicesRaw.flatMap((entry) => {
    const parsed = parseBackgroundServicePromptEntry(entry);
    return parsed ? [parsed] : [];
  });

  return {
    targetReleaseChannel: readTrimmedString(record, 'targetReleaseChannel'),
    targetServerUrl: readTrimmedString(record, 'targetServerUrl'),
    services,
  };
}

/** Recognises the CLI-choice prompt data; `null` unless it names the CLI it is about. */
export function parseSetupCliChoicePromptData(record: SystemTaskJsonObject): SetupCliChoicePromptData | null {
  const command = readTrimmedString(record, 'command');
  if (!command) return null;
  return {
    command,
    version: readTrimmedString(record, 'version'),
    origin: record.origin === 'npm' || record.origin === 'brew' ? record.origin : 'unknown',
    removalCommand: readTrimmedString(record, 'removalCommand'),
    updateCommand: readTrimmedString(record, 'updateCommand'),
    belowSetupFloor: record.belowSetupFloor === true,
    missing: record.missing === true,
    keepBlockedBy: readTrimmedString(record, 'keepBlockedBy'),
  };
}

/** The app's answer (`{ choice }`); `null` when it gave none — the question was dismissed. */
export function readSetupCliChoiceAnswer(answer: unknown): SetupCliChoice | null {
  const choice = answer && typeof answer === 'object' ? (answer as { choice?: unknown }).choice : null;
  return choice === 'managed' || choice === 'own' ? choice : null;
}

export function parseSshTrustPromptData(
  kind: 'ssh.trustHost' | 'ssh.replaceHostKey',
  record: SystemTaskJsonObject,
): SshTrustPromptData | null {
  const host = readTrimmedString(record, 'host');
  const fingerprint = readTrimmedString(record, 'fingerprint');
  if (!host || !fingerprint) {
    return null;
  }

  return {
    kind,
    host,
    keyType: readTrimmedString(record, 'keyType'),
    fingerprint,
    existingFingerprint: readTrimmedString(record, 'existingFingerprint'),
  };
}

export function parseApproveRemoteProvisioningPromptData(
  record: SystemTaskJsonObject,
): ApproveRemoteProvisioningPromptData {
  return {
    publicKey: readTrimmedString(record, 'publicKey'),
  };
}

export function parseSshPasswordPromptData(
  record: SystemTaskJsonObject,
): SshPasswordPromptData {
  return {
    target: readTrimmedString(record, 'target') ?? '',
  };
}

export function parseSshPrivateKeyPassphrasePromptData(
  record: SystemTaskJsonObject,
): SshPrivateKeyPassphrasePromptData | null {
  const promptId = readTrimmedString(record, 'promptId');
  const host = readTrimmedString(record, 'host');
  const username = readTrimmedString(record, 'username');
  if (!promptId || !host || !username) {
    return null;
  }
  return {
    promptId,
    host,
    port: readPort(record, 'port'),
    username,
    keyLabel: readTrimmedString(record, 'keyLabel'),
    attemptsRemaining: readPositiveInteger(record, 'attemptsRemaining'),
  };
}

export function parseSshKeyboardInteractivePromptData(
  record: SystemTaskJsonObject,
): SshKeyboardInteractivePromptData | null {
  const promptId = readTrimmedString(record, 'promptId');
  const host = readTrimmedString(record, 'host');
  const username = readTrimmedString(record, 'username');
  if (!promptId || !host || !username) {
    return null;
  }
  const prompts = (Array.isArray(record.prompts) ? record.prompts : []).flatMap((entry): SshKeyboardInteractivePromptEntry[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const item = entry as SystemTaskJsonObject;
    const id = readTrimmedString(item, 'id');
    const label = readTrimmedString(item, 'label');
    if (!id || !label) {
      return [];
    }
    return [{
      id,
      label,
      echo: item.echo === true,
    }];
  });
  return {
    promptId,
    host,
    port: readPort(record, 'port'),
    username,
    name: readTrimmedString(record, 'name'),
    instruction: readTrimmedString(record, 'instruction'),
    prompts,
  };
}
