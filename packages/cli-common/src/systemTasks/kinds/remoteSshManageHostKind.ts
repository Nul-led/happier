import {
  HomeConnectionDescriptorV1Schema,
  type HomeConnectionDescriptorV1,
  type SystemTaskJsonObject,
  type SystemTaskJsonValue,
} from '@happier-dev/protocol';
import { normalizePublicReleaseRingLabel } from '@happier-dev/release-runtime/releaseRings';

import { SystemTaskExecutionError } from '../runSystemTask.js';
import { redactSensitiveSystemTaskJsonValue, type InteractiveSystemTaskKind } from '../interactiveTaskKinds.js';
import { parseSystemTaskSshConfig, type SystemTaskSshConnectionConfig } from './relayRuntimeKinds.js';
import type { RemoteHostTrustResolution } from './remoteSshBootstrapMachineKind.js';
import { materializeSshIdentityPrivateKeyToTempFile } from '../ssh/materializeSshIdentityPrivateKeyToTempFile.js';
import { createPersonalHomeEraseConfirmationToken } from '../../firstPartyRuntime/personalHome/operations.js';
import type { PersonalHomeRelocationPublicationFacts } from '../../firstPartyRuntime/personalHome/relocationCoordinator.js';

export type RemoteSshManageHostAction =
  | 'testConnection'
  | 'installOrUpdateCli'
  | 'daemonService.installOrUpdate'
  | 'daemonService.start'
  | 'daemonService.stop'
  | 'daemonService.restart'
  | 'relayRuntime.status'
  | 'relayRuntime.installOrUpdate'
  | 'relayRuntime.start'
  | 'relayRuntime.stop'
  | 'relayRuntime.restart'
  | 'personalHome.relocate'
  | 'personalHome.erase';

export type RemoteSshAuth =
  | Readonly<{ mode: 'agent' }>
  | Readonly<{ mode: 'keyFile'; privateKeyPath: string }>
  | Readonly<{ mode: 'password'; password: string }>;

export type RemoteSshManageHostDeps = Readonly<{
  resolveHostTrust: (params: Readonly<{
    ssh: SystemTaskSshConnectionConfig;
    knownHostsMode: 'app' | 'system';
  }>) => Promise<RemoteHostTrustResolution>;
  testConnection: (params: Readonly<{
    ssh: SystemTaskSshConnectionConfig;
    auth: RemoteSshAuth;
    knownHostsMode: 'app' | 'system';
  }>) => Promise<void>;
  installRemoteCli: (params: Readonly<{
    ssh: SystemTaskSshConnectionConfig;
    auth: RemoteSshAuth;
    knownHostsMode: 'app' | 'system';
    channel: 'stable' | 'preview' | 'dev';
  }>) => Promise<void>;
  runDaemonServiceCommand: (params: Readonly<{
    ssh: SystemTaskSshConnectionConfig;
    auth: RemoteSshAuth;
    knownHostsMode: 'app' | 'system';
    action: 'installOrUpdate' | 'start' | 'stop' | 'restart';
    serviceMode: 'user' | 'none';
    channel: 'stable' | 'preview' | 'dev';
  }>) => Promise<void>;
  runRelayRuntimeCommand: (params: Readonly<{
    ssh: SystemTaskSshConnectionConfig;
    auth: RemoteSshAuth;
    knownHostsMode: 'app' | 'system';
    action: 'status' | 'installOrUpdate' | 'start' | 'stop' | 'restart';
    channel: 'stable' | 'preview' | 'dev';
    mode: 'user' | 'system';
  }>) => Promise<SystemTaskJsonObject | null | void>;
  runPersonalHomeCommand?: (params: Readonly<{
    ssh: SystemTaskSshConnectionConfig;
    auth: RemoteSshAuth;
    knownHostsMode: 'app' | 'system';
    channel: 'stable' | 'preview' | 'dev';
    mode: 'user' | 'system';
    args: readonly string[];
  }>) => Promise<SystemTaskJsonObject>;
  runPersonalHomeRelocation?: (params: Readonly<{
    ssh: SystemTaskSshConnectionConfig;
    auth: RemoteSshAuth;
    knownHostsMode: 'app' | 'system';
    channel: 'stable' | 'preview' | 'dev';
    mode: 'user' | 'system';
    destinationMachineId: string;
    operationId: string;
    sourceDescriptorRevision: number;
    recoveryAction?: 'finish_move' | 'return_to_source';
    signal?: AbortSignal;
    progress(stepId: string, message?: string): void;
    publishDestination(facts: PersonalHomeRelocationPublicationFacts): Promise<HomeConnectionDescriptorV1>;
    readPublishedDescriptor(homeServerIdentityId: string): Promise<HomeConnectionDescriptorV1 | null>;
  }>) => Promise<SystemTaskJsonObject>;
}>;

export function redactRemoteSshManageHostPayload(value: SystemTaskJsonValue): SystemTaskJsonValue {
  return redactSensitiveSystemTaskJsonValue(value);
}

export function createRemoteSshManageHostTaskKind(
  deps: RemoteSshManageHostDeps,
): InteractiveSystemTaskKind<SystemTaskJsonObject> {
  return {
    async run(ctx): Promise<SystemTaskJsonObject> {
      const parsed = parseRemoteSshManageHostParams(ctx.params);
      const knownHostsMode = parsed.knownHostsMode;
      let cleanupTempIdentityFile: (() => Promise<void>) | null = null;

      try {
        ctx.emit({
          type: 'progress',
          stepId: 'ssh.trust',
          message: 'Verifying SSH host trust',
        });

        const trustResolution = await deps.resolveHostTrust({
          ssh: parsed.ssh,
          knownHostsMode,
        });
        const trust = trustResolution.status === 'prompt'
          ? normalizeRemoteHostTrustResolution(trustResolution)
          : trustResolution;

        if (trust.status === 'prompt') {
          const answer = await ctx.prompt({
            kind: trust.promptKind,
            stepId: 'ssh.hostTrust',
            message: trust.promptMessage,
            data: trust.promptData,
          }) as { trusted?: boolean };
          if (answer?.trusted !== true) {
            await trust.decline?.();
            throw new SystemTaskExecutionError('host_trust_declined', 'SSH host trust was declined.');
          }
          await trust.accept();
        }

        const authResolution = await resolveRemoteSshAuth({
          ctx,
          ssh: parsed.ssh,
          identityPrivateKey: parsed.identityPrivateKey,
        });
        cleanupTempIdentityFile = authResolution.cleanup;
        const auth = authResolution.auth;

        if (parsed.action === 'testConnection') {
          ctx.emit({
            type: 'progress',
            stepId: 'ssh.testConnection',
            message: 'Testing SSH connection',
          });
          await deps.testConnection({
            ssh: parsed.ssh,
            auth,
            knownHostsMode,
          });
          return { action: parsed.action } satisfies SystemTaskJsonObject;
        }

        if (parsed.action === 'installOrUpdateCli') {
          ctx.emit({
            type: 'progress',
            stepId: 'remote.cli.install',
            message: 'Installing Happier CLI',
          });
          await deps.installRemoteCli({
            ssh: parsed.ssh,
            auth,
            knownHostsMode,
            channel: parsed.channel,
          });
          return { action: parsed.action } satisfies SystemTaskJsonObject;
        }

        if (parsed.action === 'personalHome.relocate') {
          if (!deps.runPersonalHomeRelocation) throw new SystemTaskExecutionError('unsupported', 'Remote Personal Home relocation is unavailable.');
          if (!parsed.relayRuntime || !parsed.personalHomeRelocation) {
            throw new SystemTaskExecutionError('invalid_params', 'Remote Personal Home relocation requires an exact runtime target and operation.');
          }
          const relocation = parsed.personalHomeRelocation;
          const runtimeChannel = parsed.relayRuntime.channel ?? 'stable';
          const runtimeMode = parsed.relayRuntime.mode ?? 'user';
          ctx.emit({ type: 'progress', stepId: 'remote.cli.install', message: 'Ensuring Happier CLI is installed' });
          await deps.installRemoteCli({ ssh: parsed.ssh, auth, knownHostsMode, channel: parsed.channel });
          const personalHome = await deps.runPersonalHomeRelocation({
            ssh: parsed.ssh,
            auth,
            knownHostsMode,
            channel: runtimeChannel,
            mode: runtimeMode,
            destinationMachineId: relocation.destinationMachineId,
            operationId: relocation.operationId,
            sourceDescriptorRevision: relocation.sourceDescriptorRevision,
            ...(relocation.recoveryAction ? { recoveryAction: relocation.recoveryAction } : {}),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
            progress: (stepId, message) => ctx.emit({ type: 'progress', stepId, ...(message ? { message } : {}) }),
            publishDestination: async (facts) => parseRelocationDescriptorPromptAnswer(await ctx.prompt({
              kind: 'personal_home.publish_relocation_descriptor.v1',
              stepId: 'personal_home.publish_relocation_descriptor',
              message: 'Publishing the verified Personal Home destination',
              data: facts,
            }), false),
            readPublishedDescriptor: async (homeServerIdentityId) => parseRelocationDescriptorPromptAnswer(await ctx.prompt({
              kind: 'personal_home.read_relocation_descriptor.v1',
              stepId: 'personal_home.read_relocation_descriptor',
              message: 'Reading the current Personal Home destination',
              data: { operationId: relocation.operationId, homeServerIdentityId },
            }), true),
          });
          return { action: parsed.action, personalHome } satisfies SystemTaskJsonObject;
        }

        if (parsed.action === 'personalHome.erase') {
          if (!deps.runPersonalHomeCommand) throw new SystemTaskExecutionError('unsupported', 'Remote Personal Home operations are unavailable.');
          if (!parsed.relayRuntime) {
            throw new SystemTaskExecutionError('invalid_params', 'Remote Personal Home erase requires an explicit relay runtime channel and mode.');
          }
          const runPersonalHomeCommand = deps.runPersonalHomeCommand;
          const runtimeChannel = parsed.relayRuntime.channel ?? 'stable';
          const runtimeMode = parsed.relayRuntime.mode ?? 'user';
          ctx.emit({ type: 'progress', stepId: 'remote.cli.install', message: 'Ensuring Happier CLI is installed' });
          await deps.installRemoteCli({ ssh: parsed.ssh, auth, knownHostsMode, channel: parsed.channel });
          ctx.emit({ type: 'progress', stepId: 'personal_home.inspect', message: 'Inspecting remote Personal Home' });
          const inspection = await runPersonalHomeCommand({
            ssh: parsed.ssh,
            auth,
            knownHostsMode,
            channel: parsed.channel,
            mode: runtimeMode,
            args: ['home', 'status', '--json', '--channel', runtimeChannel, '--mode', runtimeMode],
          });
          const facts = parseRemotePersonalHomeEraseFacts(inspection);
          const answer = await ctx.prompt({
            kind: 'personal_home.confirm_remote_erase.v1',
            stepId: 'personal_home.confirm_remote_erase',
            message: 'Confirm permanent deletion of the inspected remote Personal Home paths.',
            data: { paths: [...facts.paths], estimatedBytes: facts.estimatedBytes, canonicalServerUrl: facts.canonicalServerUrl, homeServerIdentityId: facts.homeServerIdentityId },
          });
          if (!isExactRemoteEraseConfirmation(answer)) {
            throw new SystemTaskExecutionError('confirmation_required', 'Remote Personal Home erase was not explicitly confirmed.');
          }
          const confirmationToken = createPersonalHomeEraseConfirmationToken(facts);
          ctx.emit({ type: 'progress', stepId: 'personal_home.erase', message: 'Erasing remote Personal Home data' });
          const erased = await runPersonalHomeCommand({
            ssh: parsed.ssh,
            auth,
            knownHostsMode,
            channel: parsed.channel,
            mode: runtimeMode,
            args: ['home', 'erase', '--json', '--channel', runtimeChannel, '--mode', runtimeMode, '--confirmation-token', confirmationToken],
          });
          if (!Array.isArray(erased.removedPaths) || erased.stoppedRunningHome !== true && erased.stoppedRunningHome !== false) {
            throw new SystemTaskExecutionError('invalid_cli_response', 'Remote Personal Home erase did not return confirmed final facts.');
          }
          return { action: parsed.action, personalHome: erased } satisfies SystemTaskJsonObject;
        }

        const relayRuntimeAction = resolveRelayRuntimeAction(parsed.action);
        if (relayRuntimeAction) {
          ctx.emit({
            type: 'progress',
            stepId: `relay.runtime.${relayRuntimeAction}`,
            message: 'Managing relay runtime',
          });

          const result = await deps.runRelayRuntimeCommand({
            ssh: parsed.ssh,
            auth,
            knownHostsMode,
            action: relayRuntimeAction,
            channel: parsed.relayRuntime?.channel ?? 'stable',
            mode: parsed.relayRuntime?.mode ?? 'user',
          });

          return {
            action: parsed.action,
            ...(result ? { relayRuntime: result } : {}),
          } satisfies SystemTaskJsonObject;
        }

        const daemonAction = resolveDaemonServiceAction(parsed.action);
        if (!daemonAction) {
          throw new SystemTaskExecutionError('invalid_params', 'Unsupported remote host action.');
        }

        ctx.emit({
          type: 'progress',
          stepId: 'remote.cli.install',
          message: 'Ensuring Happier CLI is installed',
        });
        await deps.installRemoteCli({
          ssh: parsed.ssh,
          auth,
          knownHostsMode,
          channel: parsed.channel,
        });

        ctx.emit({
          type: 'progress',
          stepId: `daemon.service.${daemonAction}`,
          message: 'Managing background service',
        });
        await deps.runDaemonServiceCommand({
          ssh: parsed.ssh,
          auth,
          knownHostsMode,
          action: daemonAction,
          serviceMode: parsed.serviceMode,
          channel: parsed.channel,
        });

        return { action: parsed.action } satisfies SystemTaskJsonObject;
      } finally {
        await cleanupTempIdentityFile?.().catch(() => {});
      }
    },
  };
}

type CanonicalRemoteHostTrustPromptKind = 'ssh.trustHost' | 'ssh.replaceHostKey';
type RemoteHostTrustPromptKind = CanonicalRemoteHostTrustPromptKind | 'sshHostTrust';

function normalizeRemoteHostTrustResolution(
  trust: Extract<RemoteHostTrustResolution, { status: 'prompt' }>,
): Extract<RemoteHostTrustResolution, { status: 'prompt' }> {
  return {
    ...trust,
    promptKind: normalizeRemoteHostTrustPromptKind(trust.promptKind as RemoteHostTrustPromptKind),
  };
}

function normalizeRemoteHostTrustPromptKind(value: RemoteHostTrustPromptKind): CanonicalRemoteHostTrustPromptKind {
  if (value === 'sshHostTrust') {
    return 'ssh.trustHost';
  }
  if (value === 'ssh.trustHost' || value === 'ssh.replaceHostKey') {
    return value;
  }
  throw new SystemTaskExecutionError('invalid_params', 'Unsupported SSH host trust prompt kind.');
}

type DaemonServiceAction = 'installOrUpdate' | 'start' | 'stop' | 'restart';

function resolveDaemonServiceAction(action: RemoteSshManageHostAction): DaemonServiceAction | null {
  if (action === 'daemonService.installOrUpdate') return 'installOrUpdate';
  if (action === 'daemonService.start') return 'start';
  if (action === 'daemonService.stop') return 'stop';
  if (action === 'daemonService.restart') return 'restart';
  return null;
}

type RelayRuntimeAction = 'status' | 'installOrUpdate' | 'start' | 'stop' | 'restart';

function resolveRelayRuntimeAction(action: RemoteSshManageHostAction): RelayRuntimeAction | null {
  if (action === 'relayRuntime.status') return 'status';
  if (action === 'relayRuntime.installOrUpdate') return 'installOrUpdate';
  if (action === 'relayRuntime.start') return 'start';
  if (action === 'relayRuntime.stop') return 'stop';
  if (action === 'relayRuntime.restart') return 'restart';
  return null;
}

async function resolveRemoteSshAuth(params: Readonly<{
  ctx: Pick<Parameters<InteractiveSystemTaskKind['run']>[0], 'prompt'>;
  ssh: SystemTaskSshConnectionConfig;
  identityPrivateKey?: string | null;
}>): Promise<Readonly<{ auth: RemoteSshAuth; cleanup: (() => Promise<void>) | null }>> {
  if (params.ssh.auth === 'password') {
    const passwordFromParams = typeof params.ssh.password === 'string' ? params.ssh.password.trim() : '';
    if (passwordFromParams) {
      return {
        auth: {
          mode: 'password',
          password: passwordFromParams,
        },
        cleanup: null,
      };
    }

    const answer = await params.ctx.prompt({
      kind: 'ssh.password',
      stepId: 'ssh.password',
      message: 'SSH password required',
      data: {
        target: params.ssh.target,
      },
    }) as { password?: unknown };
    const password = typeof answer?.password === 'string' ? answer.password.trim() : '';
    if (!password) {
      throw new SystemTaskExecutionError('password_required', 'SSH password is required.');
    }
    return {
      auth: {
        mode: 'password',
        password,
      },
      cleanup: null,
    };
  }

  if (params.ssh.auth === 'keyfile') {
    const identityFile = typeof params.ssh.identityFile === 'string' ? params.ssh.identityFile.trim() : '';
    if (identityFile) {
      return {
        auth: {
          mode: 'keyFile',
          privateKeyPath: identityFile,
        },
        cleanup: null,
      };
    }

    const privateKeyMaterial = typeof params.identityPrivateKey === 'string' ? params.identityPrivateKey.trim() : '';
    if (!privateKeyMaterial) {
      throw new SystemTaskExecutionError('invalid_params', 'Missing ssh.identityFile for keyfile auth.');
    }

    const materialized = await materializeSshIdentityPrivateKeyToTempFile({
      privateKey: privateKeyMaterial,
      prefix: 'happier-ssh-manage-host-',
    });
    return {
      auth: {
        mode: 'keyFile',
        privateKeyPath: materialized.identityFilePath,
      },
      cleanup: materialized.cleanup,
    };
  }

  return { auth: { mode: 'agent' }, cleanup: null };
}

type RemoteSshManageHostParams = Readonly<{
  action: RemoteSshManageHostAction;
  channel: 'stable' | 'preview' | 'dev';
  ssh: SystemTaskSshConnectionConfig;
  identityPrivateKey?: string;
  knownHostsMode: 'app' | 'system';
  serviceMode: 'user' | 'none';
  relayRuntime?: Readonly<{
    channel?: 'stable' | 'preview' | 'dev';
    mode?: 'user' | 'system';
  }>;
  personalHomeRelocation?: Readonly<{
    operationId: string;
    destinationMachineId: string;
    sourceDescriptorRevision: number;
    recoveryAction?: 'finish_move' | 'return_to_source';
  }>;
}>;

function parseRemoteSshManageHostParams(params: unknown): RemoteSshManageHostParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new SystemTaskExecutionError('invalid_params', 'Invalid remote host params.');
  }
  const record = params as Record<string, unknown>;
  const actionRaw = typeof record.action === 'string' ? record.action.trim() : '';
  const action = actionRaw as RemoteSshManageHostAction;
  if (!isRemoteSshManageHostAction(action)) {
    throw new SystemTaskExecutionError('invalid_params', 'Invalid remote host action.');
  }
  const sshRaw = record.ssh;
  const ssh = parseSystemTaskSshConfig(sshRaw);
  const sshRecord = sshRaw && typeof sshRaw === 'object' && !Array.isArray(sshRaw)
    ? (sshRaw as Record<string, unknown>)
    : null;
  const identityPrivateKey = sshRecord && typeof sshRecord.identityPrivateKey === 'string'
    ? sshRecord.identityPrivateKey.trim()
    : '';
  const channel = normalizePublicReleaseRingLabel(record.channel) || 'stable';
  const knownHostsMode = record.knownHostsMode === 'system' ? 'system' : 'app';
  const serviceMode = record.serviceMode === 'none' ? 'none' : 'user';
  const relayRuntimeRecord = record.relayRuntime && typeof record.relayRuntime === 'object' && !Array.isArray(record.relayRuntime)
    ? record.relayRuntime as Record<string, unknown>
    : null;
  if ((action === 'personalHome.erase' || action === 'personalHome.relocate') && (
    !relayRuntimeRecord
    || !normalizePublicReleaseRingLabel(relayRuntimeRecord.channel)
    || (relayRuntimeRecord.mode !== 'user' && relayRuntimeRecord.mode !== 'system')
  )) {
    throw new SystemTaskExecutionError(
      'invalid_params',
      'Remote Personal Home operation requires an explicit runtime channel and mode.',
    );
  }
  const relayRuntime = relayRuntimeRecord
    ? parseRelayRuntimeOptions(relayRuntimeRecord)
    : undefined;
  const relocationRecord = record.personalHomeRelocation && typeof record.personalHomeRelocation === 'object'
    && !Array.isArray(record.personalHomeRelocation)
    ? record.personalHomeRelocation as Record<string, unknown>
    : null;
  const personalHomeRelocation = action === 'personalHome.relocate'
    ? parsePersonalHomeRelocationOptions(relocationRecord)
    : undefined;

  return {
    action,
    channel,
    ssh,
    ...(identityPrivateKey ? { identityPrivateKey } : {}),
    knownHostsMode,
    serviceMode,
    ...(relayRuntime ? { relayRuntime } : {}),
    ...(personalHomeRelocation ? { personalHomeRelocation } : {}),
  };
}

function isRemoteSshManageHostAction(value: string): value is RemoteSshManageHostAction {
  return value === 'testConnection'
    || value === 'installOrUpdateCli'
    || value === 'daemonService.installOrUpdate'
    || value === 'daemonService.start'
    || value === 'daemonService.stop'
    || value === 'daemonService.restart'
    || value === 'relayRuntime.status'
    || value === 'relayRuntime.installOrUpdate'
    || value === 'relayRuntime.start'
    || value === 'relayRuntime.stop'
    || value === 'relayRuntime.restart'
    || value === 'personalHome.relocate'
    || value === 'personalHome.erase';
}

function parsePersonalHomeRelocationOptions(
  value: Record<string, unknown> | null,
): NonNullable<RemoteSshManageHostParams['personalHomeRelocation']> {
  if (!value || Object.keys(value).some((key) => key !== 'operationId' && key !== 'destinationMachineId' && key !== 'sourceDescriptorRevision' && key !== 'recoveryAction')) {
    throw new SystemTaskExecutionError('invalid_params', 'Remote Personal Home relocation requires exact operation facts.');
  }
  const operationId = typeof value.operationId === 'string' ? value.operationId.trim() : '';
  const destinationMachineId = typeof value.destinationMachineId === 'string' ? value.destinationMachineId.trim() : '';
  const sourceDescriptorRevision = value.sourceDescriptorRevision;
  const recoveryAction = value.recoveryAction;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operationId) || !destinationMachineId || destinationMachineId.length > 256
    || typeof sourceDescriptorRevision !== 'number' || !Number.isSafeInteger(sourceDescriptorRevision) || sourceDescriptorRevision < 1
    || (recoveryAction !== undefined && recoveryAction !== 'finish_move' && recoveryAction !== 'return_to_source')) {
    throw new SystemTaskExecutionError('invalid_params', 'Remote Personal Home relocation requires exact operation facts.');
  }
  return { operationId, destinationMachineId, sourceDescriptorRevision, ...(recoveryAction ? { recoveryAction } : {}) };
}

function parseRelocationDescriptorPromptAnswer(value: unknown, allowNull: false): HomeConnectionDescriptorV1;
function parseRelocationDescriptorPromptAnswer(value: unknown, allowNull: true): HomeConnectionDescriptorV1 | null;
function parseRelocationDescriptorPromptAnswer(
  value: unknown,
  allowNull: boolean,
): HomeConnectionDescriptorV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'descriptor')) {
    throw new SystemTaskExecutionError('invalid_params', 'Personal Home relocation publication returned an invalid descriptor response.');
  }
  const descriptor = (value as { descriptor?: unknown }).descriptor;
  if (allowNull && descriptor === null) return null;
  const parsed = HomeConnectionDescriptorV1Schema.safeParse(descriptor);
  if (!parsed.success) {
    throw new SystemTaskExecutionError('invalid_params', 'Personal Home relocation publication returned an invalid descriptor response.');
  }
  return parsed.data;
}

function isJsonObject(value: SystemTaskJsonValue | undefined): value is SystemTaskJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isExactRemoteEraseConfirmation(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && (value as { confirmed?: unknown }).confirmed === true;
}

function parseRemotePersonalHomeEraseFacts(value: SystemTaskJsonObject) {
  const purpose = value.purpose;
  const identity = value.identity;
  const storage = value.storage;
  if (!isJsonObject(purpose) || purpose.kind !== 'personal-home' || !isJsonObject(storage)) {
    throw new SystemTaskExecutionError('invalid_cli_response', 'Remote Personal Home inspection is incomplete.');
  }
  const canonicalServerUrl = typeof purpose.canonicalServerUrl === 'string' ? purpose.canonicalServerUrl.trim() : '';
  const identityId = isJsonObject(identity) && typeof identity.homeServerIdentityId === 'string'
    ? identity.homeServerIdentityId.trim()
    : '';
  if (identity !== null && (!isJsonObject(identity) || !identityId)) {
    throw new SystemTaskExecutionError('invalid_cli_response', 'Remote Personal Home inspection returned an invalid identity.');
  }
  const homeServerIdentityId = identity === null ? null : identityId;
  const pathsRaw = storage.ownedErasePaths;
  const paths = Array.isArray(pathsRaw) ? pathsRaw.filter((path): path is string => typeof path === 'string' && path.trim().length > 0) : [];
  const estimatedBytes = storage.estimatedOwnedBytes;
  if (!canonicalServerUrl || !Array.isArray(pathsRaw) || paths.length === 0 || paths.length !== pathsRaw.length
    || (estimatedBytes !== null && (typeof estimatedBytes !== 'number' || !Number.isFinite(estimatedBytes) || estimatedBytes < 0))) {
    throw new SystemTaskExecutionError('invalid_cli_response', 'Remote Personal Home inspection did not return exact erase facts.');
  }
  return { canonicalServerUrl, homeServerIdentityId, paths, estimatedBytes: estimatedBytes as number | null };
}

function parseRelayRuntimeOptions(value: Record<string, unknown>): NonNullable<RemoteSshManageHostParams['relayRuntime']> {
  const channel = normalizePublicReleaseRingLabel(value.channel) || 'stable';
  const mode = value.mode === 'system' ? 'system' : 'user';
  return {
    channel,
    mode,
  };
}
