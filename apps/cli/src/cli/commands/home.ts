import type { CommandContext } from '@/cli/commandRegistry';
import { getLiveSystemTasksRunnerAdapter } from '@/capabilities/systemTasks/liveSystemTasksRunner';
import { mapUnknownErrorToControlError } from '@/cli/control/controlErrorMapping';
import { printJsonEnvelope, wantsJson, writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { resolveAbsolutePathFromWorkingDirectory } from '@/utils/path/expandHomeDirPath';
import { isInteractiveTerminal, promptInput } from '@/terminal/prompts/promptInput';
import { errorFrame } from '@happier-dev/cli-common/output';
import {
  PERSONAL_HOME_SYSTEM_TASK_KINDS,
} from '@happier-dev/cli-common/systemTasks';
import { createPersonalHomeEraseConfirmationToken } from '@happier-dev/cli-common/firstPartyRuntime';
import {
  SYSTEM_TASK_PROTOCOL_VERSION,
  SystemTaskJsonValueSchema,
  type SystemTaskEvent,
  type SystemTaskJsonObject,
  type SystemTaskJsonValue,
  type SystemTaskSpec,
} from '@happier-dev/protocol';

import { type CliSystemTasksRunnerAdapter, runSystemTaskToCompletion } from './systemTaskCliRunner';

type PersonalHomePurpose = Readonly<{
  kind: 'personal-home';
  canonicalServerUrl: string;
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
    '  happier home status',
    '  happier home backup [--output PATH]',
    '  happier home verify-backup PATH',
    '  happier home restore PATH [--yes]',
    '  happier home recover-restore [--yes]',
    '  happier home finalize-restore [--yes]',
    '  happier home erase [--yes]',
    '',
    'Runtime targeting options:',
    '  --channel stable|preview|dev',
    '  --mode user|system',
  ].join('\n'));
}

function parseRuntimeChannel(value: string | null): 'stable' | 'preview' | 'dev' {
  if (value === null) return 'stable';
  if (value === 'stable' || value === 'preview' || value === 'dev') return value;
  throw Object.assign(new Error(`Unsupported Personal Home runtime channel: ${value}`), { code: 'invalid_runtime_target' });
}

function parseRuntimeMode(value: string | null): 'user' | 'system' {
  if (value === null) return 'user';
  if (value === 'user' || value === 'system') return value;
  throw Object.assign(new Error(`Unsupported Personal Home runtime mode: ${value}`), { code: 'invalid_runtime_target' });
}

async function runTask(params: Readonly<{
  runner: CliSystemTasksRunnerAdapter;
  spec: SystemTaskSpec;
  json: boolean;
  visible: boolean;
  signal?: AbortSignal;
  sleep: (ms: number) => Promise<void>;
  onPrompt?: (prompt: Readonly<{ kind: string; data: SystemTaskJsonObject }>, message: string) => Promise<unknown>;
}>): Promise<SystemTaskJsonValue> {
  const result = await runSystemTaskToCompletion({
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
  if (!canonicalServerUrl) throw Object.assign(new Error('Personal Home status did not provide its canonical server URL.'), { code: 'personal_home_status_incomplete' });
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

function printSafeFacts(data: SystemTaskJsonValue): void {
  if (!isRecord(data)) return;
  const facts: string[] = [];
  const add = (label: string, value: unknown): void => {
    if (typeof value === 'string' && value.trim()) facts.push(`${label}: ${value}`);
    else if (typeof value === 'number' || typeof value === 'boolean') facts.push(`${label}: ${String(value)}`);
  };
  add('Path', data.path);
  add('SHA-256', data.sha256);
  add('Outcome', data.outcome);
  add('Restore error', data.error);
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
    add('Backup archives', data.storage.backupsCount);
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
  const confirmationTokenFlag = takeFlagValue(yesFlag.rest, '--confirmation-token');
  const channelFlag = takeFlagValue(confirmationTokenFlag.rest, '--channel');
  const modeFlag = takeFlagValue(channelFlag.rest, '--mode');
  const runtime = {
    channel: parseRuntimeChannel(channelFlag.value),
    mode: parseRuntimeMode(modeFlag.value),
  } as const;
  const runner = deps.createRunner(runtime);
  let args = modeFlag.rest;
  const json = jsonFlag.present;
  const interactive = deps.isInteractiveTerminal() && !json;
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
    if (confirmationTokenFlag.value !== null) {
      const expected = createPersonalHomeEraseConfirmationToken({ canonicalServerUrl, homeServerIdentityId, paths, estimatedBytes });
      return { confirmed: confirmationTokenFlag.value === expected };
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
  const run = async (spec: SystemTaskSpec, visible = true): Promise<SystemTaskJsonValue> => {
    const data = await runTask({ runner, spec, json, visible, signal, sleep: deps.sleep, onPrompt });
    if (visible && !json) printSafeFacts(data);
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
      const digestFlag = takeFlagValue(archiveFlag.rest, '--bundle-sha256');
      const homeIdFlag = takeFlagValue(digestFlag.rest, '--expected-home-id');
      const canonicalUrlFlag = takeFlagValue(homeIdFlag.rest, '--expected-canonical-server-url');
      const revisionFlag = takeFlagValue(canonicalUrlFlag.rest, '--source-descriptor-revision');
      if (revisionFlag.rest.length > 0) throw new Error(`Unknown relocation destination stage arguments: ${revisionFlag.rest.join(' ')}`);
      const sourceDescriptorRevision = Number(revisionFlag.value);
      if (!Number.isSafeInteger(sourceDescriptorRevision) || sourceDescriptorRevision < 1) {
        throw new Error('Relocation destination stage requires a positive --source-descriptor-revision.');
      }
      await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.relocationDestinationStage, purpose, runtime, {
        operationId,
        archivePath: requirePath(archiveFlag.value ?? undefined, 'relocation bundle path', deps),
        bundleSha256: digestFlag.value ?? '',
        expectedHomeServerIdentityId: homeIdFlag.value ?? '',
        expectedCanonicalServerUrl: canonicalUrlFlag.value ?? '',
        sourceDescriptorRevision,
      }));
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
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.inspect, purpose, runtime));
    return;
  }

  if (subcommand === 'backup') {
    const output = takeFlagValue(args, '--output');
    args = output.rest;
    if (args.length > 0) throw new Error(`Unknown home backup arguments: ${args.join(' ')}`);
    const outputPath = output.value === null ? null : requirePath(output.value, 'backup output path', deps);
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.backup, purpose, runtime, outputPath ? { outputPath } : {}));
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
      await confirmDestructive({
        yes: yesFlag.present,
        interactive: deps.isInteractiveTerminal() && !json,
        prompt: 'Restore this verified backup and overwrite the current Personal Home data?',
        nonInteractiveMessage: 'Non-interactive restore into a non-empty Personal Home requires --yes after successful backup verification.',
        deps,
      });
    }
    const expectedHomeServerIdentityId = typeof verification.manifest.homeServerIdentityId === 'string'
      ? verification.manifest.homeServerIdentityId
      : '';
    if (!expectedHomeServerIdentityId) throw Object.assign(new Error('Verified backup is missing its Home identity.'), { code: 'invalid_backup_manifest' });
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.restore, purpose, runtime, {
      archivePath,
      ...(destinationNonEmpty ? { confirmOverwrite: true } : {}),
      expectedHomeServerIdentityId,
    }));
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
    if ((status !== 'rollback_available' && status !== 'finalization_available') || affectedTargets.length === 0) {
      throw Object.assign(new Error('Personal Home inspection returned an invalid restore recovery state.'), { code: 'personal_home_inspection_incomplete' });
    }
    if (!json) console.log(['Restore rollback is available for:', ...affectedTargets.map((target) => `- ${target}`)].join('\n'));
    await confirmDestructive({
      yes: yesFlag.present,
      interactive,
      prompt: 'Roll back the interrupted restore using the retained recovery material?',
      nonInteractiveMessage: 'Non-interactive restore recovery requires --yes.',
      deps,
    });
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.restore, purpose, runtime, { action: 'recover' }));
    return;
  }

  if (subcommand === 'finalize-restore') {
    if (args.length > 0) throw new Error(`Unknown home finalize-restore arguments: ${args.join(' ')}`);
    const inspection = await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.inspect, purpose, runtime));
    const { status, affectedTargets } = readRestoreRecoveryFacts(inspection);
    if (status === 'ambiguous') {
      throw Object.assign(new Error(`Restore finalization is ambiguous. Repair is required before mutation. Affected targets: ${affectedTargets.join(', ') || 'unknown'}`), { code: 'restore_recovery_ambiguous' });
    }
    if (status !== 'finalization_available' || affectedTargets.length === 0) {
      throw Object.assign(new Error('No completed Personal Home restore has retained material available for finalization.'), { code: 'restore_finalization_unavailable' });
    }
    if (!json) console.log(['Finalizing removes retained rollback material for:', ...affectedTargets.map((target) => `- ${target}`)].join('\n'));
    await confirmDestructive({
      yes: yesFlag.present,
      interactive,
      prompt: 'Finalize this completed restore and permanently remove its retained rollback material?',
      nonInteractiveMessage: 'Non-interactive restore finalization requires --yes.',
      deps,
    });
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.restore, purpose, runtime, { action: 'finalize' }));
    return;
  }

  if (subcommand === 'erase') {
    if (args.length > 0) {
      throw Object.assign(new Error(`Unknown home erase arguments: ${args.join(' ')}`), { code: 'invalid_params' });
    }
    await run(taskSpec(PERSONAL_HOME_SYSTEM_TASK_KINDS.erase, purpose, runtime));
    return;
  }

  throw new Error(`Unknown home subcommand: ${subcommand}`);
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
      'identity_mismatch',
      'unsupported_backup_schema',
      'invalid_backup_manifest',
      'invalid_backup_result',
      'personal_home_inspection_incomplete',
      'restore_recovery_ambiguous',
      'invalid_runtime_target',
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
