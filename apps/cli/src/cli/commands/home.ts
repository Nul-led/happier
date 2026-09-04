import type { CommandContext } from '@/cli/commandRegistry';
import { getLiveSystemTasksRunnerAdapter } from '@/capabilities/systemTasks/liveSystemTasksRunner';
import { mapUnknownErrorToControlError } from '@/cli/control/controlErrorMapping';
import { printJsonEnvelope, wantsJson, writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { resolveAbsolutePathFromWorkingDirectory } from '@/utils/path/expandHomeDirPath';
import { isInteractiveTerminal, promptInput } from '@/terminal/prompts/promptInput';
import { configuration } from '@/configuration';
import { errorFrame } from '@happier-dev/cli-common/output';
import {
  PERSONAL_HOME_SYSTEM_TASK_KINDS,
  parseRemotePersonalHomeApprovalInput,
} from '@happier-dev/cli-common/systemTasks';
import {
  cleanupPersonalHomeRelocationUpload,
  consumePersonalHomeRelocationUpload,
  PersonalHomeRelocationTransferCleanupError,
  preparePersonalHomeRelocationUpload,
} from '@happier-dev/cli-common/firstPartyRuntime';
import {
  SYSTEM_TASK_PROTOCOL_VERSION,
  HomeConnectionDescriptorV1Schema,
  SystemTaskJsonValueSchema,
  type SystemTaskEvent,
  type SystemTaskJsonObject,
  type SystemTaskJsonValue,
  type SystemTaskSpec,
  type HomeConnectionDescriptorV1,
} from '@happier-dev/protocol';

import { type CliSystemTasksRunnerAdapter, runSystemTaskToCompletion } from './systemTaskCliRunner';
import { createLocalPersonalHome, reconcileCreatedPersonalHome } from './home/createLocalPersonalHome';
import {
  encodeCliDirectHomeQrTaskStreamEvent,
  runCliDirectHomeQr,
  type CliDirectHomeQrResult,
} from '@/auth/directHomeQr/runCliDirectHomeQr';
import { linkCliHomeToAccountService } from '@/auth/accountService/linkCliHomeToAccountService';

type PersonalHomePurpose = Readonly<{
  kind: 'personal-home';
  canonicalServerUrl: string;
}>;

export type PersonalHomeCreateResult = Readonly<{
  status: 'complete';
  profileId?: string;
  homeServerIdentityId: string;
  canonicalServerUrl: string;
  accountCreated: boolean;
  channel: 'stable' | 'preview' | 'dev';
  mode: 'user' | 'system';
  descriptor?: HomeConnectionDescriptorV1;
  accountServiceLink: HomePostCreateLinkResult;
  invokingClientEnrollment?: Readonly<{ kind: 'enrolled' | 'failed' | 'not_requested' }>;
  pairing?: HomePairDeviceResult;
}>;

export type HomePairDeviceResult = CliDirectHomeQrResult;
type RemoteHomePairingResult = HomePairDeviceResult | Readonly<{ kind: 'not_requested' }>;

export type HomeLinkAccountResult =
  | Readonly<{ kind: 'linked'; homeServerIdentityId: string }>
  | Readonly<{ kind: 'relink_required'; homeServerIdentityId: string }>
  | Readonly<{ kind: 'unavailable'; reason: 'home_profile_unavailable' | 'home_credentials_unavailable' | 'account_service_credentials_unavailable' | 'home_transport_unavailable' }>
  | Readonly<{ kind: 'cancelled' | 'failed' }>;

export type HomePostCreateLinkResult = HomeLinkAccountResult | Readonly<{
  kind: 'not_requested' | 'unable_to_attempt';
}>;

export type HomeCommandDeps = Readonly<{
  createRunner: (runtime: Readonly<{
    channel: 'stable' | 'preview' | 'dev';
    mode: 'user' | 'system';
  }>) => CliSystemTasksRunnerAdapter;
  resolvePath: (value: string) => string | null;
  isInteractiveTerminal: () => boolean;
  promptInput: (prompt: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  resolveDefaultChannel: () => 'stable' | 'preview' | 'dev';
  readApprovalInput?: () => Promise<string>;
  prepareRelocationUpload?: typeof preparePersonalHomeRelocationUpload;
  consumeRelocationUpload?: typeof consumePersonalHomeRelocationUpload;
  cleanupRelocationUpload?: typeof cleanupPersonalHomeRelocationUpload;
  createPersonalHome?: (runtime: Readonly<{
    channel: 'stable' | 'preview' | 'dev';
    mode: 'user' | 'system';
  }>) => Promise<Readonly<{
    profileId: string;
    homeServerIdentityId: string;
    canonicalServerUrl: string;
    accountCreated: boolean;
    descriptor?: HomeConnectionDescriptorV1;
  }>>;
  reconcileCreatedHome?: (profileId: string, options?: Readonly<{ quiet: boolean }>) => Promise<void>;
  pairDevice?: (input: Readonly<{
    profileRef?: string;
    copyLink: boolean;
    signal?: AbortSignal;
    onInvite?: (input: Readonly<{ link: string }>) => void;
  }>) => Promise<HomePairDeviceResult>;
  linkAccount?: (input: Readonly<{ homeServerIdentityId?: string; relink: boolean; signal?: AbortSignal }>) => Promise<HomeLinkAccountResult>;
}>;

const DEFAULT_DEPS: HomeCommandDeps = {
  createRunner: (runtime) => {
    const runner = getLiveSystemTasksRunnerAdapter({ personalHomeRuntime: runtime });
    return {
      start: async (params) => await runner.start(params as never) as Readonly<{ taskId: string }>,
      poll: async (params) => await runner.poll(params as never) as Awaited<ReturnType<CliSystemTasksRunnerAdapter['poll']>>,
      respond: async (params) => await runner.respond(params as never),
    };
  },
  resolvePath: resolveAbsolutePathFromWorkingDirectory,
  isInteractiveTerminal,
  promptInput,
  sleep: async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)),
  resolveDefaultChannel: () => configuration.publicReleaseRing === 'publicdev'
    ? 'dev'
    : configuration.publicReleaseRing,
  readApprovalInput: async () => {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) input += String(chunk);
    return input;
  },
  prepareRelocationUpload: preparePersonalHomeRelocationUpload,
  consumeRelocationUpload: consumePersonalHomeRelocationUpload,
  cleanupRelocationUpload: cleanupPersonalHomeRelocationUpload,
  createPersonalHome: createLocalPersonalHome,
  reconcileCreatedHome: reconcileCreatedPersonalHome,
  pairDevice: runCliDirectHomeQr,
  linkAccount: linkCliHomeToAccountService,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function takeFlag(args: string[], name: string): Readonly<{ present: boolean; rest: string[] }> {
  const rest = args.filter((value) => value !== name);
  return { present: rest.length !== args.length, rest };
}

function takeFlagValue(args: string[], name: string): Readonly<{ value: string | null; rest: string[] }> {
  const rest: string[] = [];
  let value: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const current = String(args[index] ?? '');
    if (current === name) {
      const next = String(args[index + 1] ?? '');
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${name}.`);
      value = next;
      index += 1;
    } else if (current.startsWith(`${name}=`)) {
      value = current.slice(name.length + 1);
      if (!value) throw new Error(`Missing value for ${name}.`);
    } else {
      rest.push(current);
    }
  }
  return { value, rest };
}

function requirePath(value: string | undefined, label: string, deps: HomeCommandDeps): string {
  if (!value) throw new Error(`Missing ${label}.`);
  const resolved = deps.resolvePath(value);
  if (!resolved) throw new Error(`Invalid ${label}.`);
  return resolved;
}

function showHomeHelp(): void {
  console.log([
    'Usage:',
    '  happier home create [--ssh user@host] [--channel stable|preview|dev] [--mode user|system] [--link-account auto|never] [--yes] [--json]',
    '  happier home pair-device [--home PROFILE] [--copy-link]',
    '  happier home link-account [--home PROFILE] [--relink]',
    '  happier home status [--ssh user@host]',
    '  happier home backup [--output PATH] [--ssh user@host]',
    '  happier home verify-backup PATH [--ssh user@host]',
    '  happier home restore PATH [--ssh user@host] [--yes]',
    '  happier home recover-restore [--ssh user@host] [--yes]',
    '  happier home erase [--ssh user@host] [--yes]',
    '',
    'Runtime targeting options:',
    '  --channel stable|preview|dev',
    '  --mode user|system',
    '',
    'Home creation:',
    '  create installs or reuses the managed runtime and atomically creates a Personal Home.',
    '  Use --ssh user@host to create it on a trusted remote host; public ingress is not required for Iroh reachability.',
    '  pair-device starts a new short-lived QR/link session. link-account publishes the Home for Account Service discovery.',
    '  status, backup, verify-backup, restore, recover-restore, and erase accept --ssh for the same managed Home on a remote host.',
  ].join('\n'));
}

function parseRuntimeChannel(value: string | null, defaultChannel: 'stable' | 'preview' | 'dev'): 'stable' | 'preview' | 'dev' {
  if (value === null) return defaultChannel;
  if (value === 'stable' || value === 'preview' || value === 'dev') return value;
  throw Object.assign(new Error(`Unsupported Personal Home runtime channel: ${value}`), { code: 'invalid_runtime_target' });
}

function parseRuntimeMode(value: string | null): 'user' | 'system' {
  if (value === null) return 'user';
  if (value === 'user' || value === 'system') return value;
  throw Object.assign(new Error(`Unsupported Personal Home runtime mode: ${value}`), { code: 'invalid_runtime_target' });
}

function parseLinkAccountMode(value: string | null): 'auto' | 'never' {
  if (value === null || value === 'auto') return 'auto';
  if (value === 'never') return 'never';
  throw Object.assign(new Error(`Unsupported Account Service linking mode: ${value}`), { code: 'invalid_params' });
}

async function resolvePostCreateHomeLink(params: Readonly<{
  mode: 'auto' | 'never';
  canAttempt: boolean;
  homeServerIdentityId: string;
  linkAccount?: HomeCommandDeps['linkAccount'];
  signal?: AbortSignal;
}>): Promise<HomePostCreateLinkResult> {
  if (params.mode === 'never' || !params.canAttempt || !params.linkAccount) {
    return { kind: params.mode === 'never' ? 'not_requested' : 'unable_to_attempt' };
  }
  try {
    return await params.linkAccount({
      homeServerIdentityId: params.homeServerIdentityId,
      relink: false,
      signal: params.signal,
    });
  } catch {
    return { kind: 'failed' };
  }
}

function renderPostCreateHomeLink(
  result: HomePostCreateLinkResult,
  homeServerIdentityId: string,
  reentryCommand = `happier home link-account --home ${homeServerIdentityId}`,
): void {
  if (result.kind === 'linked' || result.kind === 'not_requested') return;
  if (result.kind === 'unavailable' && result.reason === 'account_service_credentials_unavailable') {
    console.log(`Account Service is not signed in. Link this Home later with \`happier home link-account --home ${homeServerIdentityId}\`.`);
    return;
  }
  if (result.kind === 'relink_required') {
    console.log(`This Home is linked to different Account Service trust facts. Review and rerun \`happier home link-account --home ${homeServerIdentityId} --relink\`.`);
    return;
  }
  console.log(`The Home is ready, but Account Service linking did not complete. Retry with \`${reentryCommand}\`.`);
}

async function runTask(params: Readonly<{
  runner: CliSystemTasksRunnerAdapter;
  spec: SystemTaskSpec;
  json: boolean;
  visible: boolean;
  signal?: AbortSignal;
  sleep: (ms: number) => Promise<void>;
  onPrompt?: (prompt: Readonly<{ kind: string; data: SystemTaskJsonObject }>, message: string) => Promise<unknown>;
  projectData?: (data: SystemTaskJsonValue) => SystemTaskJsonValue;
}>): Promise<SystemTaskJsonValue> {
  const rawResult = await runSystemTaskToCompletion({
    runner: params.runner,
    spec: params.spec,
    signal: params.signal,
    sleep: params.sleep,
    onPrompt: params.onPrompt,
    onEvent: params.visible
      ? async (event: SystemTaskEvent) => {
          if (params.json) await writeJsonStdout(event);
          else if (event.type !== 'prompt' && (event.message || event.stepId)) console.log(event.message ?? event.stepId);
        }
      : undefined,
  });
  const result = rawResult.ok && params.projectData
    ? { ...rawResult, data: params.projectData(rawResult.data ?? null) }
    : rawResult;
  if (params.visible && params.json) await writeJsonStdout({
    kind: 'personal_home_task_result',
    protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
    result,
  });
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code, personalHomeTaskFailure: true });
  return result.data ?? null;
}

async function readPersonalHomePurpose(params: Readonly<{
  runner: CliSystemTasksRunnerAdapter;
  signal?: AbortSignal;
  sleep: (ms: number) => Promise<void>;
  runtime: Readonly<{
    channel: 'stable' | 'preview' | 'dev';
    mode: 'user' | 'system';
  }>;
}>): Promise<PersonalHomePurpose> {
  const data = await runTask({
    ...params,
    json: false,
    visible: false,
    spec: {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      kind: 'relay.runtime.status.v1',
      params: { target: { kind: 'local' }, ...params.runtime },
    },
  });
  if (!isRecord(data) || !isRecord(data.purpose) || data.purpose.kind !== 'personal-home') {
    throw Object.assign(new Error('The installed managed runtime is not a Personal Home.'), { code: 'purpose_not_personal_home' });
  }
  const canonicalServerUrl = typeof data.purpose.canonicalServerUrl === 'string'
    ? data.purpose.canonicalServerUrl.trim()
    : '';
  if (!canonicalServerUrl) throw Object.assign(new Error('Personal Home status did not provide its Home address.'), { code: 'personal_home_status_incomplete' });
  return { kind: 'personal-home', canonicalServerUrl };
}

function taskSpec(
  kind: string,
  purpose: PersonalHomePurpose,
  runtime: Readonly<{ channel: 'stable' | 'preview' | 'dev'; mode: 'user' | 'system' }>,
  extra: Record<string, SystemTaskJsonValue> = {},
): SystemTaskSpec {
  return {
    protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
    kind,
    params: { target: { kind: 'local' }, ...runtime, purpose, ...extra },
  };
}

type PersonalHomeOperationLabel = 'Backup' | 'Restore' | 'Erase';

function printSafeFacts(data: SystemTaskJsonValue, operation?: PersonalHomeOperationLabel): void {
  if (!isRecord(data)) return;
  const facts: string[] = [];
  const add = (label: string, value: unknown): void => {
    if (typeof value === 'string' && value.trim()) facts.push(`${label}: ${value}`);
    else if (typeof value === 'number' || typeof value === 'boolean') facts.push(`${label}: ${String(value)}`);
  };
  add('Path', data.path);
  add('SHA-256', data.sha256);
  add('Outcome', data.outcome);
  add(operation ? `${operation} error` : 'Operation error', data.error);
  add('Home needs attention', data.homeNeedsAttention);
  add('Stopped running Home', data.stoppedRunningHome);
  if (Array.isArray(data.removedPaths)) {
    for (const path of data.removedPaths) add('Removed', path);
  }
  if (Array.isArray(data.remainingOwnedPaths)) {
    for (const path of data.remainingOwnedPaths) add('Remaining owned', path);
  }
  if (Array.isArray(data.remainingUnknownPaths)) {
    for (const path of data.remainingUnknownPaths) add('Remaining unknown', path);
  }
  if (Array.isArray(data.rollbackPaths)) {
    for (const path of data.rollbackPaths) add('Rollback retained at', path);
  }
  add('Running', data.running);
  add('Identity match', data.identityMatchesCurrentHome);
  add('Destination verified', data.destinationVerified);
  add('Source stopped', data.sourceStopped);
  if (isRecord(data.manifest)) {
    add('Home identity', data.manifest.homeServerIdentityId);
    add('Created', data.manifest.createdAt);
    add('Schema', data.manifest.schemaVersion);
    add('Archive format', data.manifest.format);
    add('Archive version', data.manifest.version);
  }
  if (isRecord(data.layout)) {
    add('Data directory', data.layout.dataDir);
    add('Database', data.layout.databasePath);
    add('Public files', data.layout.publicFilesDir);
    add('Private files', data.layout.privateFilesDir);
    add('Backups', data.layout.backupsDir);
  }
  if (isRecord(data.storage)) {
    add('Database bytes', data.storage.databaseBytes);
    if (typeof data.storage.backupsCount === 'number') {
      add('Backup archives', data.storage.backupsCountComplete === false
        ? `${String(data.storage.backupsCount)}+`
        : data.storage.backupsCount);
    }
    add('Estimated owned bytes', data.storage.estimatedOwnedBytes);
    if (Array.isArray(data.storage.ownedErasePaths)) {
      for (const path of data.storage.ownedErasePaths) add('Owned erase path', path);
    }
  }
  if (facts.length > 0) console.log(facts.join('\n'));
}

function readRestoreRecoveryFacts(inspection: SystemTaskJsonValue): Readonly<{
  status: string;
  affectedTargets: readonly string[];
}> {
  const recovery = isRecord(inspection) && isRecord(inspection.restoreRecovery)
    ? inspection.restoreRecovery
    : null;
  return {
    status: typeof recovery?.status === 'string' ? recovery.status : '',
    affectedTargets: Array.isArray(recovery?.affectedTargets)
      ? recovery.affectedTargets.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [],
  };
}

async function confirmDestructive(params: Readonly<{
  yes: boolean;
  interactive: boolean;
  prompt: string;
  nonInteractiveMessage: string;
  deps: HomeCommandDeps;
}>): Promise<void> {
  if (params.yes) return;
  if (!params.interactive) throw Object.assign(new Error(params.nonInteractiveMessage), { code: 'confirmation_required' });
  const answer = await params.deps.promptInput(`${params.prompt} [y/N]: `);
  if (!/^y(?:es)?$/i.test(answer.trim())) throw Object.assign(new Error('Destructive operation was not confirmed; no mutation task was started.'), { code: 'confirmation_declined' });
}

export async function handleHomeCommand(
  argsRaw: string[],
  deps: HomeCommandDeps = DEFAULT_DEPS,
  signal?: AbortSignal,
): Promise<void> {
  const subcommand = argsRaw[0];
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showHomeHelp();
    return;
  }
  const jsonFlag = takeFlag(argsRaw.slice(1), '--json');
  const yesFlag = takeFlag(jsonFlag.rest, '--yes');
  const approvalStdinFlag = takeFlag(yesFlag.rest, '--approval-stdin');
  const channelFlag = takeFlagValue(approvalStdinFlag.rest, '--channel');
  const modeFlag = takeFlagValue(channelFlag.rest, '--mode');
  const linkAccountModeFlag = takeFlagValue(modeFlag.rest, '--link-account');
  const sshFlag = takeFlagValue(linkAccountModeFlag.rest, '--ssh');
  const runtime = {
    channel: parseRuntimeChannel(channelFlag.value, deps.resolveDefaultChannel()),
    mode: parseRuntimeMode(modeFlag.value),
  } as const;
  let args = sshFlag.rest;
  const json = jsonFlag.present;
  const interactive = deps.isInteractiveTerminal() && !json;
  if (approvalStdinFlag.present && yesFlag.present) {
    throw Object.assign(new Error('Do not combine --approval-stdin with --yes.'), { code: 'invalid_params' });
  }
  if (subcommand === 'create') {
    const aliasFlag = takeFlag(args, '--this-computer');
    args = aliasFlag.rest;
    if (args.length > 0) throw new Error(`Unknown home create arguments: ${args.join(' ')}`);
    if (aliasFlag.present && sshFlag.value) {
      throw Object.assign(new Error('Do not combine --this-computer with --ssh.'), { code: 'invalid_params' });
    }
    const linkAccountMode = parseLinkAccountMode(linkAccountModeFlag.value);
    if (!yesFlag.present && !interactive) {
      throw Object.assign(
        new Error('Personal Home creation requires an interactive terminal or explicit --yes.'),
        { code: 'interactive_required' },
      );
    }
    if (!yesFlag.present) {
      const answer = await deps.promptInput([
        sshFlag.value
          ? `Create a Personal Home on remote SSH host ${sshFlag.value} with the fixed managed preset?`
          : 'Create a Personal Home on this computer with the fixed managed preset?',
        `Mode: ${runtime.mode}`,
        `Channel: ${runtime.channel}`,
        sshFlag.value
          ? `Storage: plaintext at rest on ${sshFlag.value}; continue only if you trust that remote host.`
          : 'Storage: plaintext on this computer; use only a machine you trust.',
        'This installs or reuses the managed server, creates the initial account, closes signup, and configures the local service.',
        '[y/N]: ',
      ].join('\n'));
      if (!/^y(?:es)?$/iu.test(answer.trim())) {
        throw Object.assign(
          new Error('Personal Home creation was cancelled before any changes were made.'),
          { code: 'confirmation_declined' },
        );
      }
    }
    if (sshFlag.value) {
      const remoteData = await runTask({
        runner: deps.createRunner(runtime),
        spec: {
          protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
          kind: 'remote.ssh.manageHost.v1',
          params: {
            action: 'personalHome.create',
            channel: runtime.channel,
            relayRuntime: runtime,
            pairDevice: interactive,
            enrollInvokingClient: linkAccountMode === 'auto',
            ssh: { target: sshFlag.value, auth: 'agent' },
          },
        },
        json,
        visible: false,
        signal,
        sleep: deps.sleep,
        onPrompt: async (prompt, message) => {
          if (prompt.kind !== 'ssh.trustHost' && prompt.kind !== 'ssh.replaceHostKey') {
            throw Object.assign(new Error(`Remote Personal Home creation requires unsupported input: ${prompt.kind}`), { code: 'prompt_required' });
          }
          if (yesFlag.present) return { trusted: true };
          const answer = await deps.promptInput(`${message || 'Trust this SSH host key?'}\nTrust this host key? [y/N]: `);
          return { trusted: /^y(?:es)?$/iu.test(answer.trim()) };
        },
      });
      const created = parseRemotePersonalHomeCreateTaskData(remoteData);
      const { pairing, invokingClientEnrollment, ...createdFacts } = created;
      const accountServiceLink = await resolvePostCreateHomeLink({
        mode: linkAccountMode,
        canAttempt: invokingClientEnrollment.kind === 'enrolled',
        homeServerIdentityId: created.homeServerIdentityId,
        linkAccount: deps.linkAccount,
        signal,
      });
      const result: PersonalHomeCreateResult = {
        ...createdFacts,
        channel: runtime.channel,
        mode: runtime.mode,
        accountServiceLink,
        invokingClientEnrollment,
        ...(pairing.kind === 'not_requested' ? {} : { pairing }),
      };
      if (json) {
        await printJsonEnvelope({ ok: true, kind: 'personal_home_create', data: result }, { exitCode: 0 });
      } else {
        console.log(`Remote Personal Home ready at ${created.canonicalServerUrl}`);
        const pairingReentry = invokingClientEnrollment.kind === 'enrolled'
          ? `happier home pair-device --home ${created.homeServerIdentityId}`
          : `happier home create --ssh ${sshFlag.value} --link-account ${linkAccountMode}`;
        if (pairing.kind === 'cancelled' || pairing.kind === 'expired') {
          console.log(`Device pairing did not complete. Retry with \`${pairingReentry}\`.`);
        } else if (pairing.kind !== 'completed' && pairing.kind !== 'not_requested') {
          console.log(`The Home was created, but device pairing is incomplete. Retry with \`${pairingReentry}\`.`);
        }
        if (linkAccountMode === 'auto') {
          renderPostCreateHomeLink(
            accountServiceLink,
            created.homeServerIdentityId,
            invokingClientEnrollment.kind === 'enrolled'
              ? undefined
              : `happier home create --ssh ${sshFlag.value} --link-account auto`,
          );
        }
      }
      return;
    }
    if (!deps.createPersonalHome || !deps.reconcileCreatedHome) {
      throw Object.assign(new Error('Local Personal Home creation is unavailable in this build.'), { code: 'personal_home_create_unavailable' });
    }
    const created = await deps.createPersonalHome(runtime);
    await deps.reconcileCreatedHome(created.profileId, { quiet: json });
    if (interactive && deps.pairDevice) {
      const paired = await deps.pairDevice({ profileRef: created.profileId, copyLink: false, signal });
      if (paired.kind === 'update_required') {
        console.log('This Home requires an update before another device can be paired. Retry with `happier home pair-device`.');
      } else if (paired.kind !== 'completed' && paired.kind !== 'cancelled' && paired.kind !== 'expired') {
        console.log('Device pairing did not complete. Retry with `happier home pair-device`.');
      }
    }
    const accountServiceLink = await resolvePostCreateHomeLink({
      mode: linkAccountMode,
      canAttempt: true,
      homeServerIdentityId: created.homeServerIdentityId,
      linkAccount: deps.linkAccount,
      signal,
    });
    const result: PersonalHomeCreateResult = {
      status: 'complete',
      profileId: created.profileId,
      homeServerIdentityId: created.homeServerIdentityId,
      canonicalServerUrl: created.canonicalServerUrl,
      accountCreated: created.accountCreated,
      channel: runtime.channel,
      mode: runtime.mode,
      ...(created.descriptor ? { descriptor: created.descriptor } : {}),
      accountServiceLink,
    };
    if (json) {
      await printJsonEnvelope({ ok: true, kind: 'personal_home_create', data: result }, { exitCode: 0 });
    } else {
      console.log(`Personal Home ready at ${created.canonicalServerUrl}`);
      renderPostCreateHomeLink(accountServiceLink, created.homeServerIdentityId);
    }
    return;
  }
  if (approvalStdinFlag.present && subcommand !== 'restore' && subcommand !== 'recover-restore' && subcommand !== 'erase') {
    throw Object.assign(new Error('--approval-stdin is reserved for remote destructive Home execution.'), { code: 'invalid_params' });
  }
  if (linkAccountModeFlag.value !== null) {
    throw Object.assign(new Error('--link-account is supported only by `happier home create`.'), { code: 'invalid_params' });
  }
  if (subcommand === 'pair-device') {
    if (sshFlag.value) throw Object.assign(new Error('--ssh is not supported by home pair-device.'), { code: 'invalid_params' });
    const homeFlag = takeFlagValue(args, '--home');
    const copyLinkFlag = takeFlag(homeFlag.rest, '--copy-link');
    const taskStreamFlag = takeFlag(copyLinkFlag.rest, '--system-task-stream');
    if (taskStreamFlag.rest.length > 0) throw new Error(`Unknown home pair-device arguments: ${taskStreamFlag.rest.join(' ')}`);
    if (taskStreamFlag.present) {
      if (json || copyLinkFlag.present) {
        throw Object.assign(new Error('System-task pairing stream cannot be combined with public output flags.'), { code: 'invalid_params' });
      }
      if (!deps.pairDevice) throw Object.assign(new Error('Direct Home device pairing is unavailable in this build.'), { code: 'pair_device_unavailable' });
      const outcome = await deps.pairDevice({
        ...(homeFlag.value ? { profileRef: homeFlag.value } : {}),
        copyLink: false,
        signal,
        onInvite: ({ link }) => console.log(encodeCliDirectHomeQrTaskStreamEvent({ v: 1, kind: 'home_pair_device.invite', link })),
      });
      console.log(encodeCliDirectHomeQrTaskStreamEvent({ v: 1, kind: 'home_pair_device.result', result: outcome }));
      return;
    }
    if (json) throw Object.assign(new Error('Device pairing QR and enrollment links are not available in JSON output.'), { code: 'interactive_required' });
    if (!deps.pairDevice) throw Object.assign(new Error('Direct Home device pairing is unavailable in this build.'), { code: 'pair_device_unavailable' });
    if (!deps.isInteractiveTerminal() && !copyLinkFlag.present) {
      throw Object.assign(new Error('A terminal is required to render the QR code; use --copy-link for the explicit link-only flow.'), { code: 'interactive_required' });
    }
    const outcome = await deps.pairDevice({
      ...(homeFlag.value ? { profileRef: homeFlag.value } : {}),
      copyLink: copyLinkFlag.present,
      signal,
    });
    if (outcome.kind === 'completed') {
      console.log(`Device paired${outcome.requestedDeviceLabel ? `: ${outcome.requestedDeviceLabel}` : '.'}`);
      return;
    }
    if (outcome.kind === 'cancelled') throw Object.assign(new Error('Device pairing was cancelled.'), { code: 'cancelled' });
    if (outcome.kind === 'expired') throw Object.assign(new Error('The pairing session expired. Run `happier home pair-device` to start a new session.'), { code: 'pairing_expired' });
    if (outcome.kind === 'update_required') throw Object.assign(new Error('This Home does not advertise the required bound-qr-v2 capability. Update the Home and retry.'), { code: 'update_required' });
    if (outcome.kind === 'invalid_request') throw Object.assign(new Error('The joining device request did not match this Home QR session.'), { code: 'invalid_pairing_request' });
    if (outcome.kind === 'failed') throw Object.assign(new Error(`Device pairing failed (${outcome.status}).`), { code: 'pairing_failed' });
    throw Object.assign(new Error('Device pairing did not reach a terminal state.'), { code: 'pairing_failed' });
  }
  if (subcommand === 'link-account') {
    if (sshFlag.value) throw Object.assign(new Error('--ssh is not supported by home link-account.'), { code: 'invalid_params' });
    const homeFlag = takeFlagValue(args, '--home');
    const relinkFlag = takeFlag(homeFlag.rest, '--relink');
    if (relinkFlag.rest.length > 0) throw new Error(`Unknown home link-account arguments: ${relinkFlag.rest.join(' ')}`);
    if (!deps.linkAccount) throw Object.assign(new Error('Account Service Home linking is unavailable in this build.'), { code: 'link_account_unavailable' });
    const outcome = await deps.linkAccount({
      ...(homeFlag.value ? { homeServerIdentityId: homeFlag.value } : {}),
      relink: relinkFlag.present,
      signal,
    });
    if (outcome.kind === 'linked') {
      console.log('Home linked to Account Service.');
      return;
    }
    if (outcome.kind === 'relink_required' && !relinkFlag.present) {
      throw Object.assign(new Error('This Home is already linked to different Account Service trust facts. Rerun with --relink only after reviewing that replacement.'), { code: 'relink_required' });
    }
    if (outcome.kind === 'unavailable') throw Object.assign(new Error(`Home linking is unavailable: ${outcome.reason}.`), { code: outcome.reason });
    if (outcome.kind === 'cancelled') throw Object.assign(new Error('Home linking was cancelled.'), { code: 'cancelled' });
    if (outcome.kind === 'relink_required') throw Object.assign(new Error('Account Service relink was not accepted.'), { code: 'relink_required' });
    throw Object.assign(new Error('Account Service Home linking failed.'), { code: 'link_account_failed' });
  }
  if (sshFlag.value) {
    const actionByCommand = {
      status: 'personalHome.status',
      backup: 'personalHome.backup',
      'verify-backup': 'personalHome.verifyBackup',
      restore: 'personalHome.restore',
      'recover-restore': 'personalHome.recoverRestore',
      erase: 'personalHome.erase',
    } as const;
    const action = actionByCommand[subcommand as keyof typeof actionByCommand];
    if (!action) throw Object.assign(new Error(`--ssh is not supported by home ${subcommand}.`), { code: 'invalid_params' });
    let personalHomeOperation: SystemTaskJsonObject | undefined;
    if (subcommand === 'status' || subcommand === 'recover-restore' || subcommand === 'erase') {
      if (args.length > 0) throw Object.assign(new Error(`Unknown home ${subcommand} arguments: ${args.join(' ')}`), { code: 'invalid_params' });
    } else if (subcommand === 'backup') {
      const output = takeFlagValue(args, '--output');
      if (output.rest.length > 0) throw Object.assign(new Error(`Unknown home backup arguments: ${output.rest.join(' ')}`), { code: 'invalid_params' });
      if (output.value !== null) personalHomeOperation = { outputPath: requirePath(output.value, 'backup output path', deps) };
    } else {
      if (args.length !== 1) throw Object.assign(new Error(`Usage: happier home ${subcommand} --ssh user@host PATH${subcommand === 'restore' ? ' [--yes]' : ''}`), { code: 'invalid_params' });
      personalHomeOperation = { archivePath: requirePath(args[0], 'backup archive path', deps) };
    }
    const remoteData = await runTask({
      runner: deps.createRunner(runtime),
      spec: {
        protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
        kind: 'remote.ssh.manageHost.v1',
        params: {
          action,
          channel: runtime.channel,
          relayRuntime: runtime,
          ssh: { target: sshFlag.value, auth: 'agent' },
          ...(personalHomeOperation ? { personalHomeOperation } : {}),
        },
      },
      json: false,
      visible: false,
      signal,
      sleep: deps.sleep,
      onPrompt: async (prompt, message) => {
        if (prompt.kind === 'ssh.trustHost' || prompt.kind === 'ssh.replaceHostKey') {
          if (yesFlag.present) return { trusted: true };
          if (!interactive) return { trusted: false };
          const answer = await deps.promptInput(`${message || 'Trust this SSH host key?'}\nTrust this host key? [y/N]: `);
          return { trusted: /^y(?:es)?$/iu.test(answer.trim()) };
        }
        if (prompt.kind.startsWith('personal_home.confirm_remote_')) {
          const data = prompt.data;
          const paths = Array.isArray(data.paths) ? data.paths.filter((path): path is string => typeof path === 'string') : [];
          if (data.sshHost !== sshFlag.value
            || typeof data.homeServerIdentityId !== 'string' || !data.homeServerIdentityId.trim()
            || typeof data.canonicalServerUrl !== 'string' || !data.canonicalServerUrl.trim()
            || !Array.isArray(data.paths) || paths.length !== data.paths.length || paths.length === 0
            || (data.estimatedBytes !== null && (typeof data.estimatedBytes !== 'number' || !Number.isSafeInteger(data.estimatedBytes) || data.estimatedBytes < 0))) {
            return { confirmed: false };
          }
          if (yesFlag.present) return { confirmed: true };
          if (!interactive) return { confirmed: false };
          const answer = await deps.promptInput([
            `Confirm ${subcommand} on remote SSH host ${sshFlag.value}?`,
            `Home: ${data.canonicalServerUrl}`,
            `Home identity: ${data.homeServerIdentityId}`,
            ...paths.map((path) => `- ${path}`),
            `Estimated owned bytes: ${data.estimatedBytes === null ? 'unknown' : String(data.estimatedBytes)}`,
            '[y/N]: ',
          ].join('\n'));
          return { confirmed: /^y(?:es)?$/iu.test(answer.trim()) };
        }
        throw Object.assign(new Error(`Remote Personal Home operation requires unsupported input: ${prompt.kind}`), { code: 'prompt_required' });
      },
    });
    if (!isRecord(remoteData) || remoteData.action !== action || !isRecord(remoteData.personalHome)) {
      throw Object.assign(new Error('Remote Personal Home operation returned an invalid result.'), { code: 'invalid_cli_response' });
    }
    if (json) {
      await printJsonEnvelope({ ok: true, kind: 'personal_home_remote_operation', data: remoteData }, { exitCode: 0 });
    } else {
      printSafeFacts(remoteData.personalHome,
        subcommand === 'backup' ? 'Backup' : subcommand === 'restore' ? 'Restore' : subcommand === 'erase' ? 'Erase' : undefined);
    }
    if ((subcommand === 'restore' || subcommand === 'recover-restore')
      && (remoteData.personalHome.outcome === 'rolled_back' || remoteData.personalHome.outcome === 'recovery_required')) {
      throw Object.assign(new Error(`Remote Personal Home ${subcommand} did not complete.`), { code: 'personal_home_restore_incomplete' });
    }
    if (subcommand === 'erase' && remoteData.personalHome.outcome === 'partial') {
      throw Object.assign(new Error('Remote Personal Home erase was only partially completed.'), { code: 'personal_home_erase_incomplete' });
    }
    return;
  }
  const runner = deps.createRunner(runtime);
  let remoteApproval: ReturnType<typeof parseRemotePersonalHomeApprovalInput> | null | undefined;
  const readRemoteApproval = async () => {
    if (remoteApproval !== undefined) return remoteApproval;
    try {
      remoteApproval = parseRemotePersonalHomeApprovalInput(await (deps.readApprovalInput?.() ?? Promise.reject(new Error('Approval input is unavailable.'))));
    } catch {
      remoteApproval = null;
    }
    return remoteApproval;
  };
  const approvalMatches = async (params: Readonly<{
    operation: 'restore' | 'recover-restore' | 'erase';
    canonicalServerUrl: string;
    homeServerIdentityId: string;
    paths: readonly string[];
    estimatedBytes: number | null;
  }>): Promise<boolean> => {
    const approval = await readRemoteApproval();
    return approval !== null
      && approval.operation === params.operation
      && approval.canonicalServerUrl === params.canonicalServerUrl
      && approval.homeServerIdentityId === params.homeServerIdentityId
      && approval.estimatedBytes === params.estimatedBytes
      && approval.paths.length === params.paths.length
      && approval.paths.every((path, index) => path === params.paths[index]);
  };
  const onPrompt = async (prompt: Readonly<{ kind: string; data: SystemTaskJsonObject }>): Promise<unknown> => {
    if (prompt.kind !== 'personal_home.confirm_erase.v1') {
      throw Object.assign(new Error(`Unsupported Personal Home task prompt: ${prompt.kind}`), { code: 'prompt_required' });
    }
    const rawPaths = prompt.data.paths;
    const paths = Array.isArray(rawPaths)
      ? rawPaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const estimatedBytes = prompt.data.estimatedBytes;
    const canonicalServerUrl = typeof prompt.data.canonicalServerUrl === 'string' ? prompt.data.canonicalServerUrl.trim() : '';
    const homeServerIdentityId = prompt.data.homeServerIdentityId === null
      || (typeof prompt.data.homeServerIdentityId === 'string' && prompt.data.homeServerIdentityId.trim().length > 0)
      ? prompt.data.homeServerIdentityId
      : undefined;
    if (!Array.isArray(rawPaths)
      || paths.length !== rawPaths.length
      || paths.length === 0
      || !canonicalServerUrl
      || homeServerIdentityId === undefined
      || (estimatedBytes !== null && (typeof estimatedBytes !== 'number' || !Number.isFinite(estimatedBytes) || estimatedBytes < 0))) {
      return { confirmed: false };
    }
    if (approvalStdinFlag.present) {
      return { confirmed: typeof homeServerIdentityId === 'string' && await approvalMatches({
        operation: 'erase', canonicalServerUrl, homeServerIdentityId, paths, estimatedBytes,
      }) };
    }
    if (yesFlag.present) return { confirmed: true };
    if (!interactive) return { confirmed: false };
    const answer = await deps.promptInput([
      'Permanently erase the owner-validated Personal Home paths below?',
      `Home: ${canonicalServerUrl}`,
      `Home identity: ${homeServerIdentityId ?? 'unavailable'}`,
      ...paths.map((path) => `- ${path}`),
      `Estimated owned bytes: ${estimatedBytes === null ? 'unknown' : String(estimatedBytes)}`,
      '[y/N]: ',
    ].join('\n'));
    return { confirmed: /^y(?:es)?$/i.test(answer.trim()) };
  };
  const purpose = await readPersonalHomePurpose({ runner, signal, sleep: deps.sleep, runtime });
  const run = async (
    spec: SystemTaskSpec,
    visible = true,
    operation?: PersonalHomeOperationLabel,
    projectData?: (data: SystemTaskJsonValue) => SystemTaskJsonValue,
  ): Promise<SystemTaskJsonValue> => {
    const data = await runTask({ runner, spec, json, visible, signal, sleep: deps.sleep, onPrompt, projectData });
    if (visible && !json) printSafeFacts(data, operation);
    return data;
  };

  if (subcommand === 'relocation-destination') {
    const action = args[0];
    args = args.slice(1);
    const operationIdFlag = takeFlagValue(args, '--operation-id');
    args = operationIdFlag.rest;
    const operationId = operationIdFlag.value?.trim() ?? '';
    if (!operationId) throw new Error('Relocation destination operation requires --operation-id.');
    if (action === 'status' || action === 'abort') {
      if (args.length > 0) throw new Error(`Unknown relocation destination ${action} arguments: ${args.join(' ')}`);
      await run(taskSpec(
        action === 'status'
          ? PERSONAL_HOME_SYSTEM_TASK_KINDS.relocationDestinationStatus
          : PERSONAL_HOME_SYSTEM_TASK_KINDS.relocationDestinationAbort,
        purpose,
        runtime,
        { operationId },
      ));
      return;
    }
    if (action === 'stage') {
      const archiveFlag = takeFlagValue(args, '--archive');
      const prepareUploadFlag = takeFlag(archiveFlag.rest, '--prepare-upload');
      const uploadReceiptFlag = takeFlagValue(prepareUploadFlag.rest, '--upload-receipt');
      if (prepareUploadFlag.present) {
        if (archiveFlag.value !== null || uploadReceiptFlag.value !== null || uploadReceiptFlag.rest.length > 0) {
          throw new Error('Relocation upload preparation accepts only --operation-id and --prepare-upload.');
        }
        const prepared = await (deps.prepareRelocationUpload ?? preparePersonalHomeRelocationUpload)({ operationId });
        await writeJsonStdout({
          kind: 'personal_home_task_result',
          protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
          result: {
            protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
            taskId: `relocation-upload:${operationId}`,
            ok: true,
            data: { operationId: prepared.operationId, uploadLocator: prepared.uploadLocator },
          },
        });
        return;
      }
      const digestFlag = takeFlagValue(uploadReceiptFlag.rest, '--bundle-sha256');
      const homeIdFlag = takeFlagValue(digestFlag.rest, '--expected-home-id');
      const canonicalUrlFlag = takeFlagValue(homeIdFlag.rest, '--expected-canonical-server-url');
      const revisionFlag = takeFlagValue(canonicalUrlFlag.rest, '--source-descriptor-revision');
      if (revisionFlag.rest.length > 0) throw new Error(`Unknown relocation destination stage arguments: ${revisionFlag.rest.join(' ')}`);
      const sourceDescriptorRevision = Number(revisionFlag.value);
      if (!Number.isSafeInteger(sourceDescriptorRevision) || sourceDescriptorRevision < 1) {
        throw new Error('Relocation destination stage requires a positive --source-descriptor-revision.');
      }
      if ((archiveFlag.value === null) === (uploadReceiptFlag.value === null)) {
        throw new Error('Relocation destination stage requires exactly one of --archive or --upload-receipt.');
      }
      const stageParams = {
        operationId,
        bundleSha256: digestFlag.value ?? '',
        expectedHomeServerIdentityId: homeIdFlag.value ?? '',
        expectedCanonicalServerUrl: canonicalUrlFlag.value ?? '',
        sourceDescriptorRevision,
      };
      const uploadReceipt = uploadReceiptFlag.value;
      if (uploadReceipt === null) {
        await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.relocationDestinationStage, purpose, runtime, {
          ...stageParams,
          archivePath: requirePath(archiveFlag.value ?? undefined, 'relocation bundle path', deps),
        }));
        return;
      }
      let data: SystemTaskJsonValue | undefined;
      let stageError: unknown;
      let cleanupNeedsAttention = false;
      try {
        // Consumption and the stage task both own the reserved destination-side
        // transfer directory; the exact reservation is cleaned even when either
        // fails.
        const { archivePath } = await (deps.consumeRelocationUpload ?? consumePersonalHomeRelocationUpload)({
          operationId,
          uploadReceipt,
        });
        data = await runTask({
          runner,
          spec: taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.relocationDestinationStage, purpose, runtime, {
            ...stageParams,
            archivePath,
          }),
          json: false,
          visible: false,
          signal,
          sleep: deps.sleep,
          onPrompt,
        });
      } catch (error) {
        stageError = error;
      } finally {
        try {
          await (deps.cleanupRelocationUpload ?? cleanupPersonalHomeRelocationUpload)({ operationId });
        } catch {
          cleanupNeedsAttention = true;
        }
      }
      if (stageError !== undefined) {
        if (cleanupNeedsAttention) throw new PersonalHomeRelocationTransferCleanupError(stageError);
        throw stageError;
      }
      if (data === undefined) throw new Error('Relocation destination stage returned no result.');
      const resultData = cleanupNeedsAttention && isRecord(data)
        ? { ...data, transferCleanupNeedsAttention: true }
        : data;
      await writeJsonStdout({
        kind: 'personal_home_task_result',
        protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
        result: {
          protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
          taskId: `relocation-stage:${operationId}`,
          ok: true,
          data: resultData,
        },
      });
      return;
    }
    if (action === 'commit') {
      const descriptorFlag = takeFlagValue(args, '--published-descriptor-json');
      if (descriptorFlag.rest.length > 0) throw new Error(`Unknown relocation destination commit arguments: ${descriptorFlag.rest.join(' ')}`);
      let publishedDescriptor: SystemTaskJsonValue;
      try {
        publishedDescriptor = SystemTaskJsonValueSchema.parse(JSON.parse(descriptorFlag.value ?? ''));
      } catch {
        throw new Error('Relocation destination commit requires valid --published-descriptor-json.');
      }
      await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.relocationDestinationCommit, purpose, runtime, {
        operationId,
        publishedDescriptor,
      }));
      return;
    }
    throw new Error('Usage: happier home relocation-destination <stage|status|commit|abort> --operation-id ID ... --json');
  }

  if (subcommand === 'status') {
    if (args.length > 0) throw new Error(`Unknown home status arguments: ${args.join(' ')}`);
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.inspect, purpose, runtime), true, undefined, (data) => (
      isRecord(data) ? { ...data, purpose } : data
    ));
    return;
  }

  if (subcommand === 'backup') {
    const output = takeFlagValue(args, '--output');
    args = output.rest;
    if (args.length > 0) throw new Error(`Unknown home backup arguments: ${args.join(' ')}`);
    const outputPath = output.value === null ? null : requirePath(output.value, 'backup output path', deps);
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.backup, purpose, runtime, outputPath ? { outputPath } : {}), true, 'Backup');
    return;
  }

  if (subcommand === 'verify-backup') {
    if (args.length !== 1) throw new Error('Usage: happier home verify-backup PATH');
    const archivePath = requirePath(args[0], 'backup archive path', deps);
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.verifyBackup, purpose, runtime, { archivePath }));
    return;
  }

  if (subcommand === 'restore') {
    if (args.length !== 1) throw new Error('Usage: happier home restore PATH [--yes]');
    const archivePath = requirePath(args[0], 'backup archive path', deps);
    const inspection = await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.inspect, purpose, runtime));
    const destinationEmpty = isRecord(inspection)
      && isRecord(inspection.storage)
      && inspection.storage.destinationEmpty === true;
    const destinationNonEmpty = isRecord(inspection)
      && isRecord(inspection.storage)
      && inspection.storage.destinationEmpty === false;
    if (!destinationEmpty && !destinationNonEmpty) {
      throw Object.assign(new Error('Personal Home inspection did not establish whether the restore destination is empty.'), { code: 'personal_home_inspection_incomplete' });
    }
    const verification = await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.verifyBackup, purpose, runtime, { archivePath }));
    if (!isRecord(verification) || !isRecord(verification.manifest)) {
      throw Object.assign(new Error('Backup verification did not return a valid manifest; restore was not started.'), { code: 'invalid_backup_manifest' });
    }
    if (verification.identityMatchesCurrentHome === 'mismatch'
      || (verification.identityMatchesCurrentHome !== 'match' && !destinationEmpty)) {
      throw Object.assign(new Error('Backup identity does not match this Personal Home; restore was not started.'), { code: 'identity_mismatch' });
    }
    if (verification.manifest.format !== 'happier-personal-home-backup' || verification.manifest.version !== 1) {
      throw Object.assign(new Error('Backup schema is unsupported; restore was not started.'), { code: 'unsupported_backup_schema' });
    }
    if (destinationNonEmpty) {
      const identity = isRecord(inspection.identity) && typeof inspection.identity.homeServerIdentityId === 'string'
        ? inspection.identity.homeServerIdentityId
        : '';
      const paths = isRecord(inspection.storage) && Array.isArray(inspection.storage.ownedErasePaths)
        ? inspection.storage.ownedErasePaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
        : [];
      const estimatedBytes = isRecord(inspection.storage)
        && (inspection.storage.estimatedOwnedBytes === null || typeof inspection.storage.estimatedOwnedBytes === 'number')
        ? inspection.storage.estimatedOwnedBytes
        : null;
      const remotelyApproved = approvalStdinFlag.present && identity && paths.length > 0
        ? await approvalMatches({
            operation: 'restore', canonicalServerUrl: purpose.canonicalServerUrl,
            homeServerIdentityId: identity, paths, estimatedBytes,
          })
        : false;
      if (approvalStdinFlag.present && !remotelyApproved) {
        throw Object.assign(new Error('Remote restore approval no longer matches the current Personal Home.'), { code: 'confirmation_required' });
      }
      if (!remotelyApproved) {
        await confirmDestructive({
          yes: yesFlag.present,
          interactive: deps.isInteractiveTerminal() && !json,
          prompt: 'Restore this verified backup and overwrite the current Personal Home data?',
          nonInteractiveMessage: 'Non-interactive restore into a non-empty Personal Home requires --yes after successful backup verification.',
          deps,
        });
      }
    }
    const expectedHomeServerIdentityId = typeof verification.manifest.homeServerIdentityId === 'string'
      ? verification.manifest.homeServerIdentityId
      : '';
    if (!expectedHomeServerIdentityId) throw Object.assign(new Error('Verified backup is missing its Home identity.'), { code: 'invalid_backup_manifest' });
    const result = await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.restore, purpose, runtime, {
      archivePath,
      ...(destinationNonEmpty ? { confirmOverwrite: true } : {}),
      expectedHomeServerIdentityId,
    }), true, 'Restore');
    if (isRecord(result) && (result.outcome === 'rolled_back' || result.outcome === 'recovery_required')) {
      throw Object.assign(
        new Error(result.error === undefined
          ? `Personal Home restore did not complete (${result.outcome}).`
          : `Personal Home restore did not complete (${result.outcome}): ${String(result.error)}`),
        { code: 'personal_home_restore_incomplete', personalHomeTaskFailure: true },
      );
    }
    return;
  }

  if (subcommand === 'recover-restore') {
    if (args.length > 0) throw new Error(`Unknown home recover-restore arguments: ${args.join(' ')}`);
    const inspection = await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.inspect, purpose, runtime));
    const { status, affectedTargets } = readRestoreRecoveryFacts(inspection);
    if (status === 'none') {
      if (!json) console.log('No interrupted Personal Home restore needs recovery.');
      return;
    }
    if (status === 'ambiguous') {
      throw Object.assign(new Error(`Restore recovery is ambiguous. Repair is required before mutation. Affected targets: ${affectedTargets.join(', ') || 'unknown'}`), { code: 'restore_recovery_ambiguous' });
    }
    if (status !== 'rollback_available' || affectedTargets.length === 0) {
      throw Object.assign(new Error('Personal Home inspection returned an invalid restore recovery state.'), { code: 'personal_home_inspection_incomplete' });
    }
    if (!json) console.log(['Restore rollback is available for:', ...affectedTargets.map((target) => `- ${target}`)].join('\n'));
    const inspectionRecord = isRecord(inspection) ? inspection : null;
    const recoveryIdentity = isRecord(inspectionRecord?.identity) && typeof inspectionRecord.identity.homeServerIdentityId === 'string'
      ? inspectionRecord.identity.homeServerIdentityId
      : '';
    const recoveryBytes = isRecord(inspectionRecord?.storage)
      && (inspectionRecord.storage.estimatedOwnedBytes === null || typeof inspectionRecord.storage.estimatedOwnedBytes === 'number')
      ? inspectionRecord.storage.estimatedOwnedBytes
      : null;
    const remotelyApproved = approvalStdinFlag.present && recoveryIdentity
      ? await approvalMatches({
          operation: 'recover-restore', canonicalServerUrl: purpose.canonicalServerUrl,
          homeServerIdentityId: recoveryIdentity, paths: affectedTargets, estimatedBytes: recoveryBytes,
        })
      : false;
    if (approvalStdinFlag.present && !remotelyApproved) {
      throw Object.assign(new Error('Remote restore-recovery approval no longer matches the current Personal Home.'), { code: 'confirmation_required' });
    }
    if (!remotelyApproved) {
      await confirmDestructive({
        yes: yesFlag.present,
        interactive,
        prompt: 'Roll back the interrupted restore using the retained recovery material?',
        nonInteractiveMessage: 'Non-interactive restore recovery requires --yes.',
        deps,
      });
    }
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.restore, purpose, runtime, { action: 'recover' }));
    return;
  }

  if (subcommand === 'erase') {
    if (args.length > 0) {
      throw Object.assign(new Error(`Unknown home erase arguments: ${args.join(' ')}`), { code: 'invalid_params' });
    }
    const result = await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.erase, purpose, runtime), true, 'Erase');
    if (isRecord(result) && result.outcome === 'partial') {
      throw Object.assign(
        new Error(result.error === undefined
          ? 'Personal Home erase was only partially completed.'
          : `Personal Home erase was only partially completed: ${String(result.error)}`),
        { code: 'personal_home_erase_incomplete', personalHomeTaskFailure: true },
      );
    }
    return;
  }

  throw new Error(`Unknown home subcommand: ${subcommand}`);
}

function parseRemotePersonalHomeCreateTaskData(
  value: SystemTaskJsonValue,
): Omit<PersonalHomeCreateResult, 'channel' | 'mode' | 'accountServiceLink' | 'invokingClientEnrollment' | 'pairing'> & Readonly<{
  pairing: RemoteHomePairingResult;
  invokingClientEnrollment: Readonly<{ kind: 'enrolled' | 'failed' | 'not_requested' }>;
}> {
  if (!isRecord(value) || value.action !== 'personalHome.create' || !isRecord(value.personalHome)) {
    throw Object.assign(new Error('Remote Personal Home task returned an invalid result.'), { code: 'invalid_cli_response' });
  }
  const data = value.personalHome;
  const descriptor = HomeConnectionDescriptorV1Schema.safeParse(data.descriptor);
  const pairing = parseRemoteHomePairingResult(data.pairing);
  const invokingClientEnrollment = parseRemoteInvokingClientEnrollmentResult(data.invokingClientEnrollment);
  if (data.status !== 'complete'
    || typeof data.homeServerIdentityId !== 'string'
    || typeof data.canonicalServerUrl !== 'string'
    || typeof data.accountCreated !== 'boolean'
    || !descriptor.success
    || !pairing
    || !invokingClientEnrollment
    || descriptor.data.homeServerIdentityId !== data.homeServerIdentityId
    || descriptor.data.canonicalServerUrl !== data.canonicalServerUrl) {
    throw Object.assign(new Error('Remote Personal Home task returned invalid identity or descriptor facts.'), { code: 'invalid_cli_response' });
  }
  return {
    status: 'complete',
    homeServerIdentityId: data.homeServerIdentityId,
    canonicalServerUrl: data.canonicalServerUrl,
    accountCreated: data.accountCreated,
    descriptor: descriptor.data,
    pairing,
    invokingClientEnrollment,
  };
}

function parseRemoteHomePairingResult(value: unknown): RemoteHomePairingResult | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if ((value.kind === 'not_requested' || value.kind === 'cancelled' || value.kind === 'expired'
    || value.kind === 'invalid_request' || value.kind === 'update_required')
    && Object.keys(value).length === 1) {
    return { kind: value.kind };
  }
  if (value.kind === 'completed'
    && Object.keys(value).length === 2
    && Object.hasOwn(value, 'requestedDeviceLabel')
    && (value.requestedDeviceLabel === null || typeof value.requestedDeviceLabel === 'string')) {
    return { kind: 'completed', requestedDeviceLabel: value.requestedDeviceLabel };
  }
  if (value.kind === 'failed'
    && Object.keys(value).length === 2
    && Number.isInteger(value.status)
    && Number(value.status) >= 0) {
    return { kind: 'failed', status: Number(value.status) };
  }
  return null;
}

function parseRemoteInvokingClientEnrollmentResult(
  value: unknown,
): Readonly<{ kind: 'enrolled' | 'failed' | 'not_requested' }> | null {
  if (!isRecord(value) || Object.keys(value).length !== 1) return null;
  return value.kind === 'enrolled' || value.kind === 'failed' || value.kind === 'not_requested'
    ? { kind: value.kind }
    : null;
}

export async function handleHomeCliCommand(context: CommandContext): Promise<void> {
  const json = wantsJson(context.args);
  try {
    await handleHomeCommand(context.args.slice(1), DEFAULT_DEPS, context.signal);
  } catch (error) {
    const errorRecord = isRecord(error) ? error : null;
    const rawCode = typeof errorRecord?.code === 'string' ? errorRecord.code : null;
    const expectedHomeCodes = new Set([
      'cancelled',
      'purpose_not_personal_home',
      'personal_home_status_incomplete',
      'confirmation_required',
      'confirmation_declined',
      'interactive_required',
      'identity_mismatch',
      'unsupported_backup_schema',
      'invalid_backup_manifest',
      'invalid_backup_result',
      'personal_home_inspection_incomplete',
      'personal_home_restore_incomplete',
      'personal_home_erase_incomplete',
      'home_create_reconciliation_failed',
      'restore_recovery_ambiguous',
      'invalid_runtime_target',
      'invalid_params',
      'pair_device_unavailable',
      'link_account_unavailable',
      'pairing_expired',
      'update_required',
      'invalid_pairing_request',
      'pairing_failed',
      'relink_required',
      'home_profile_unavailable',
      'home_credentials_unavailable',
      'account_service_credentials_unavailable',
      'home_transport_unavailable',
      'link_account_failed',
    ]);
    const mapped = rawCode && (errorRecord?.personalHomeTaskFailure === true || expectedHomeCodes.has(rawCode))
      ? { code: rawCode, unexpected: false, ...(error instanceof Error && error.message ? { message: error.message } : {}) }
      : mapUnknownErrorToControlError(error);
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'personal_home_operation',
        error: { code: mapped.code, ...(mapped.message ? { message: mapped.message } : {}) },
      }, { exitCode: mapped.unexpected ? 2 : 1 });
      return;
    }
    console.error(errorFrame('Error:', [error instanceof Error ? error.message : 'Unknown error']));
    process.exitCode = typeof process.exitCode === 'number' && process.exitCode > 1 ? process.exitCode : 1;
  }
}
