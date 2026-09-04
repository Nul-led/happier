import {
  createOpenSshHappierJsonExecutor,
  parseStrictPersonalHomeTaskFinalResult,
  type RelayRuntimeTaskParams,
  type SystemTaskSshConnectionConfig,
} from '@happier-dev/cli-common/systemTasks';
import {
  PersonalHomeRelocationTransferCleanupError,
  type PersonalHomeRelocationDestinationFacts,
  type PersonalHomeRelocationDestinationOwner,
  type PersonalHomeRelocationDestinationStageInput,
} from '@happier-dev/cli-common/firstPartyRuntime';
import {
  HomeConnectionDescriptorV1Schema,
  IrohEndpointDescriptorV1Schema,
  type SystemTaskJsonObject,
} from '@happier-dev/protocol';
import type { OpenSshAuth } from '@happier-dev/cli-common/ssh';
import {
  copyLocalDirectoryToRemoteSync,
  runOpenSshRemoteCommand,
  safeBashSingleQuote,
} from '@happier-dev/cli-common/ssh';

import { redactSshText } from '../ssh/index.js';
import { checkRelayRuntimeHealthDefault, controlRelayRuntimeDefault, installOrUpdateRelayRuntimeDefault, readRelayRuntimeStatusDefault } from './relayRuntimeTasks.js';
import { normalizeBootstrapChannel, resolveDefaultKnownHostsPath } from './taskRuntime.js';
import { installRemoteFirstPartyComponent, resolveRemoteInstalledFirstPartyBinaryPath } from './remoteFirstPartyPayloadInstaller.js';

type RemoteSshAuth =
  | Readonly<{ mode: 'agent' }>
  | Readonly<{ mode: 'keyFile'; privateKeyPath: string }>
  | Readonly<{ mode: 'password'; password: string }>;

type SshConnectionWithPasswordConfig = SystemTaskSshConnectionConfig & Readonly<{ password?: string }>;

const PERSONAL_HOME_RELOCATION_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PERSONAL_HOME_RELOCATION_SHA256 = /^[a-f0-9]{64}$/u;
const PERSONAL_HOME_RELOCATION_DESTINATION_STATUSES = new Set([
  'absent',
  'receiving',
  'staged',
  'quarantined',
  'activating',
  'active',
  'aborted',
  'recovery_required',
]);

function buildRemoteSshConnection(
  ssh: SystemTaskSshConnectionConfig,
  auth: RemoteSshAuth,
): SshConnectionWithPasswordConfig {
  return {
    ...ssh,
    auth: auth.mode === 'keyFile'
      ? 'keyfile'
      : auth.mode === 'password'
        ? 'password'
        : 'agent',
    ...(auth.mode === 'keyFile' ? { identityFile: auth.privateKeyPath } : {}),
    ...(auth.mode === 'password' ? { password: auth.password } : {}),
  };
}

function resolveKnownHostsConfig(
  ssh: SystemTaskSshConnectionConfig,
  knownHostsMode: 'app' | 'system',
): Readonly<{ mode: 'app'; path: string } | { mode: 'system' }> {
  if (knownHostsMode === 'system') return { mode: 'system' };
  return { mode: 'app', path: ssh.knownHostsPath || resolveDefaultKnownHostsPath() };
}

function resolveOpenSshAuth(ssh: SshConnectionWithPasswordConfig): OpenSshAuth {
  return ssh.auth === 'keyfile'
    ? { mode: 'keyFile', privateKeyPath: String(ssh.identityFile ?? '') }
    : ssh.auth === 'password'
      ? { mode: 'password', password: String(ssh.password ?? '') }
      : { mode: 'agent' };
}

async function runRemoteText(params: Readonly<{
  ssh: SshConnectionWithPasswordConfig;
  knownHosts: Readonly<{ mode: 'app'; path: string } | { mode: 'system' }>;
  auth: OpenSshAuth;
  remoteCommand: string;
  signal?: AbortSignal;
  errorPrefix: string;
}>) {
  return await runOpenSshRemoteCommand({
    target: params.ssh.target,
    port: params.ssh.port,
    sshConfigFile: params.ssh.sshConfigFile,
    knownHostsMode: params.knownHosts.mode,
    knownHostsPath: params.knownHosts.mode === 'app' ? params.knownHosts.path : undefined,
    auth: params.auth,
    remoteCommand: ['bash', '-lc', safeBashSingleQuote(params.remoteCommand)],
    connectTimeoutSec: 10,
    signal: params.signal,
    errorPrefix: params.errorPrefix,
  });
}

function assertRelocationOperationId(operationId: string): void {
  if (!PERSONAL_HOME_RELOCATION_OPERATION_ID.test(operationId)) {
    throw new Error('Invalid Personal Home relocation operation id.');
  }
}

function parseRelocationDestinationFacts(
  value: SystemTaskJsonObject,
  expectedOperationId: string,
): Awaited<ReturnType<PersonalHomeRelocationDestinationOwner['status']>> {
  const allowedKeys = new Set([
    'operationId',
    'status',
    'bundleSha256',
    'expectedHomeServerIdentityId',
    'expectedCanonicalServerUrl',
    'sourceDescriptorRevision',
    'homeServerIdentityId',
    'canonicalServerUrl',
    'minimumOuterRevisionExclusive',
    'endpoint',
    'authenticated',
    'accountCount',
    'sessionCount',
    'failureCode',
    'transferCleanupNeedsAttention',
    'cleanupNeedsAttention',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))
    || value.operationId !== expectedOperationId
    || typeof value.status !== 'string'
    || !PERSONAL_HOME_RELOCATION_DESTINATION_STATUSES.has(value.status)) {
    throw new Error('Remote Personal Home relocation destination returned invalid operation facts.');
  }
  if (value.status === 'absent') {
    if (Object.keys(value).some((key) => key !== 'operationId' && key !== 'status' && key !== 'transferCleanupNeedsAttention')
      || (value.transferCleanupNeedsAttention !== undefined && value.transferCleanupNeedsAttention !== true)) {
      throw new Error('Remote Personal Home relocation destination returned invalid absent facts.');
    }
    return {
      operationId: expectedOperationId,
      status: 'absent',
      ...(value.transferCleanupNeedsAttention === true ? { transferCleanupNeedsAttention: true as const } : {}),
    };
  }
  if (typeof value.bundleSha256 !== 'string' || !PERSONAL_HOME_RELOCATION_SHA256.test(value.bundleSha256)
    || typeof value.expectedHomeServerIdentityId !== 'string' || !value.expectedHomeServerIdentityId.trim()
    || typeof value.expectedCanonicalServerUrl !== 'string' || !value.expectedCanonicalServerUrl.trim()
    || typeof value.sourceDescriptorRevision !== 'number'
    || !Number.isSafeInteger(value.sourceDescriptorRevision) || value.sourceDescriptorRevision < 1
    || (value.homeServerIdentityId !== undefined && (typeof value.homeServerIdentityId !== 'string' || !value.homeServerIdentityId.trim()))
    || (value.canonicalServerUrl !== undefined && (typeof value.canonicalServerUrl !== 'string' || !value.canonicalServerUrl.trim()))
    || (value.minimumOuterRevisionExclusive !== undefined
      && (typeof value.minimumOuterRevisionExclusive !== 'number'
        || !Number.isSafeInteger(value.minimumOuterRevisionExclusive)
        || value.minimumOuterRevisionExclusive < value.sourceDescriptorRevision))
    || (value.authenticated !== undefined && value.authenticated !== true)
    || (value.accountCount !== undefined
      && (typeof value.accountCount !== 'number' || !Number.isSafeInteger(value.accountCount) || value.accountCount < 1))
    || (value.sessionCount !== undefined
      && (typeof value.sessionCount !== 'number' || !Number.isSafeInteger(value.sessionCount) || value.sessionCount < 0))
    || (value.failureCode !== undefined && (typeof value.failureCode !== 'string' || !value.failureCode.trim()))
    || (value.transferCleanupNeedsAttention !== undefined && value.transferCleanupNeedsAttention !== true)
    || (value.cleanupNeedsAttention !== undefined && value.cleanupNeedsAttention !== true)) {
    throw new Error('Remote Personal Home relocation destination returned invalid operation facts.');
  }
  if ((value.status === 'quarantined' || value.status === 'activating' || value.status === 'active')
    && (value.authenticated !== true || typeof value.accountCount !== 'number' || typeof value.sessionCount !== 'number')) {
    throw new Error('Remote Personal Home relocation destination returned unattested operation facts.');
  }
  const endpoint = value.endpoint === undefined
    ? undefined
    : IrohEndpointDescriptorV1Schema.safeParse(value.endpoint);
  if (endpoint && !endpoint.success) {
    throw new Error('Remote Personal Home relocation destination returned an invalid endpoint descriptor.');
  }
  return {
    operationId: expectedOperationId,
    status: value.status as PersonalHomeRelocationDestinationFacts['status'],
    bundleSha256: value.bundleSha256,
    expectedHomeServerIdentityId: value.expectedHomeServerIdentityId,
    expectedCanonicalServerUrl: value.expectedCanonicalServerUrl,
    sourceDescriptorRevision: value.sourceDescriptorRevision,
    ...(typeof value.homeServerIdentityId === 'string' ? { homeServerIdentityId: value.homeServerIdentityId } : {}),
    ...(typeof value.canonicalServerUrl === 'string' ? { canonicalServerUrl: value.canonicalServerUrl } : {}),
    ...(typeof value.minimumOuterRevisionExclusive === 'number' ? { minimumOuterRevisionExclusive: value.minimumOuterRevisionExclusive } : {}),
    ...(endpoint?.success ? { endpoint: endpoint.data } : {}),
    ...(value.authenticated === true ? { authenticated: true as const } : {}),
    ...(typeof value.accountCount === 'number' ? { accountCount: value.accountCount } : {}),
    ...(typeof value.sessionCount === 'number' ? { sessionCount: value.sessionCount } : {}),
    ...(typeof value.failureCode === 'string' ? { failureCode: value.failureCode } : {}),
    ...(value.transferCleanupNeedsAttention === true ? { transferCleanupNeedsAttention: true as const } : {}),
    ...(value.cleanupNeedsAttention === true ? { cleanupNeedsAttention: true as const } : {}),
  };
}

function parseRelocationUpload(value: SystemTaskJsonObject, operationId: string): Readonly<{
  uploadLocator: string;
  uploadReceipt: string;
}> {
  if (Object.keys(value).some((key) => !['operationId', 'uploadLocator', 'uploadReceipt'].includes(key))
    || value.operationId !== operationId
    || typeof value.uploadLocator !== 'string'
    || !value.uploadLocator.trim()
    || /[\r\n\0]/u.test(value.uploadLocator)
    || typeof value.uploadReceipt !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.uploadReceipt)) {
    throw new Error('Remote Personal Home relocation destination returned an invalid upload receipt.');
  }
  return { uploadLocator: value.uploadLocator, uploadReceipt: value.uploadReceipt };
}

function sanitizeRelocationTransferError(error: unknown, uploadLocator: string): Error {
  const rawMessage = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Personal Home relocation archive transfer failed.';
  const sanitizedMessage = redactSshText(rawMessage)
    .split(uploadLocator)
    .join('[redacted-destination-upload]');
  return new Error(sanitizedMessage || 'Personal Home relocation archive transfer failed.');
}

export async function testRemoteSshConnectionDefault(params: Readonly<{
  ssh: SystemTaskSshConnectionConfig;
  auth: RemoteSshAuth;
  knownHostsMode: 'app' | 'system';
}>): Promise<void> {
  const ssh = buildRemoteSshConnection(params.ssh, params.auth);
  const knownHosts = resolveKnownHostsConfig(ssh, params.knownHostsMode);
  const auth: OpenSshAuth = ssh.auth === 'keyfile'
    ? { mode: 'keyFile', privateKeyPath: String(ssh.identityFile ?? '') }
    : ssh.auth === 'password'
      ? { mode: 'password', password: String(ssh.password ?? '') }
      : { mode: 'agent' };

  await runRemoteText({
    ssh,
    knownHosts,
    auth,
    remoteCommand: 'true',
    errorPrefix: `SSH connection failed for ${ssh.target}`,
  });
}

export async function installRemoteCliForManageHostDefault(params: Readonly<{
  ssh: SystemTaskSshConnectionConfig;
  auth: RemoteSshAuth;
  knownHostsMode: 'app' | 'system';
  channel: 'stable' | 'preview' | 'dev';
}>): Promise<void> {
  const ssh = buildRemoteSshConnection(params.ssh, params.auth);
  const { releaseChannel } = normalizeBootstrapChannel(params.channel);
  await installRemoteFirstPartyComponent({
    componentId: 'happier-cli',
    channel: releaseChannel === 'publicdev' ? 'dev' : releaseChannel,
    ssh,
    knownHostsMode: params.knownHostsMode,
  });
}

export async function runRemoteDaemonServiceCommandDefault(params: Readonly<{
  ssh: SystemTaskSshConnectionConfig;
  auth: RemoteSshAuth;
  knownHostsMode: 'app' | 'system';
  action: 'installOrUpdate' | 'start' | 'stop' | 'restart';
  serviceMode: 'user' | 'none';
  channel: 'stable' | 'preview' | 'dev';
}>): Promise<void> {
  const ssh = buildRemoteSshConnection(params.ssh, params.auth);
  const knownHosts = resolveKnownHostsConfig(ssh, params.knownHostsMode);
  const { releaseChannel } = normalizeBootstrapChannel(params.channel);
  const happier = resolveRemoteInstalledFirstPartyBinaryPath({
    componentId: 'happier-cli',
    channel: releaseChannel === 'publicdev' ? 'dev' : releaseChannel,
  });
  const mode = params.serviceMode === 'none' ? 'user' : params.serviceMode;
  const action = params.action === 'installOrUpdate' ? 'install' : params.action;
  const auth: OpenSshAuth = ssh.auth === 'keyfile'
    ? { mode: 'keyFile', privateKeyPath: String(ssh.identityFile ?? '') }
    : ssh.auth === 'password'
      ? { mode: 'password', password: String(ssh.password ?? '') }
      : { mode: 'agent' };

  await runRemoteText({
    ssh,
    knownHosts,
    auth,
    remoteCommand: `${happier} service ${action} --mode=${mode} --json`,
    errorPrefix: `Remote background service command failed for ${ssh.target}`,
  });
}

export async function runRemoteRelayRuntimeCommandDefault(params: Readonly<{
  ssh: SystemTaskSshConnectionConfig;
  auth: RemoteSshAuth;
  knownHostsMode: 'app' | 'system';
  action: 'status' | 'installOrUpdate' | 'start' | 'stop' | 'restart';
  channel: 'stable' | 'preview' | 'dev';
  mode: 'user' | 'system';
  purpose?: Extract<RelayRuntimeTaskParams['purpose'], { kind: 'personal-home' }>;
}>): Promise<SystemTaskJsonObject | null> {
  const ssh = buildRemoteSshConnection(params.ssh, params.auth);
  const taskParams: RelayRuntimeTaskParams = {
    target: {
      kind: 'ssh',
      ssh,
    },
    channel: params.channel,
    mode: params.mode,
    ...(params.purpose ? { purpose: params.purpose } : {}),
  };

  if (params.action === 'status') {
    const snapshot = await readRelayRuntimeStatusDefault(taskParams);
    const healthy = typeof snapshot.healthy === 'boolean'
      ? snapshot.healthy
      : await checkRelayRuntimeHealthDefault({ baseUrl: snapshot.baseUrl });
    return {
      installed: snapshot.installed,
      version: snapshot.version,
      relayUrl: snapshot.baseUrl,
      healthy,
      service: {
        active: snapshot.service.active,
        enabled: snapshot.service.enabled,
      },
    } satisfies SystemTaskJsonObject;
  }

  if (params.action === 'installOrUpdate') {
    const installed = await installOrUpdateRelayRuntimeDefault(taskParams, {
      ensureRemoteCliInstalled: false,
    });
    return {
      relayUrl: installed.relayUrl,
      mode: installed.mode,
    } satisfies SystemTaskJsonObject;
  }

  await controlRelayRuntimeDefault({
    ...taskParams,
    action: params.action,
  });
  return null;
}

export async function runRemotePersonalHomeCommandDefault(params: Readonly<{
  ssh: SystemTaskSshConnectionConfig;
  auth: RemoteSshAuth;
  knownHostsMode: 'app' | 'system';
  channel: 'stable' | 'preview' | 'dev';
  mode: 'user' | 'system';
  args: readonly string[];
  signal?: AbortSignal;
}>): Promise<SystemTaskJsonObject> {
  const ssh = buildRemoteSshConnection(params.ssh, params.auth);
  const knownHosts = resolveKnownHostsConfig(ssh, params.knownHostsMode);
  const auth: OpenSshAuth = ssh.auth === 'keyfile'
    ? { mode: 'keyFile', privateKeyPath: String(ssh.identityFile ?? '') }
    : ssh.auth === 'password'
      ? { mode: 'password', password: String(ssh.password ?? '') }
      : { mode: 'agent' };
  const executor = createOpenSshHappierJsonExecutor({
    ssh,
    auth,
    knownHostsMode: params.knownHostsMode,
    channel: params.channel === 'dev' ? 'publicdev' : params.channel,
    runRemoteText: async ({ remoteCommand, signal }) => {
      signal?.throwIfAborted();
      return await runRemoteText({
        ssh,
        knownHosts,
        auth,
        remoteCommand,
        signal,
        errorPrefix: `Remote Personal Home command failed for ${ssh.target}`,
      });
    },
  });
  const output = await executor.runHappierText(params.args, { signal: params.signal });
  if (output.status !== 0) {
    throw new Error(redactSshText(output.stderr || output.stdout || `Remote Personal Home command failed for ${ssh.target}.`));
  }
  const data = parseStrictPersonalHomeTaskFinalResult(output.stdout).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Remote Personal Home command did not return an object result.');
  }
  return data;
}

/**
 * Source-facing adapter for the destination-local relocation owner. Archive paths supplied to
 * `stage` are local to the source host; the operation-scoped remote transfer path stays private to
 * this SSH boundary and is removed after the installed destination CLI has consumed it.
 */
export function createRemoteSshPersonalHomeRelocationDestinationDefault(params: Readonly<{
  ssh: SystemTaskSshConnectionConfig;
  auth: RemoteSshAuth;
  knownHostsMode: 'app' | 'system';
  channel: 'stable' | 'preview' | 'dev';
  mode: 'user' | 'system';
  ensureRuntime(purpose: Extract<RelayRuntimeTaskParams['purpose'], { kind: 'personal-home' }>): Promise<void>;
}>): PersonalHomeRelocationDestinationOwner {
  const ssh = buildRemoteSshConnection(params.ssh, params.auth);
  const knownHosts = resolveKnownHostsConfig(ssh, params.knownHostsMode);
  const auth = resolveOpenSshAuth(ssh);
  const destinationCommand = async (args: readonly string[]) => await runRemotePersonalHomeCommandDefault({
      ssh: params.ssh,
      auth: params.auth,
      knownHostsMode: params.knownHostsMode,
      channel: params.channel,
      mode: params.mode,
      args: [
        'home',
        'relocation-destination',
        ...args,
        '--json',
        '--channel',
        params.channel,
        '--mode',
        params.mode,
      ],
    });
  const remoteCommand = async (args: readonly string[], operationId: string) => parseRelocationDestinationFacts(
    await destinationCommand(args),
    operationId,
  );
  const status = async (operationId: string) => {
    assertRelocationOperationId(operationId);
    return await remoteCommand(['status', '--operation-id', operationId], operationId);
  };

  return Object.freeze({
    status,
    stage: async (input: PersonalHomeRelocationDestinationStageInput) => {
      assertRelocationOperationId(input.operationId);
      if (!input.archivePath.trim()
        || !PERSONAL_HOME_RELOCATION_SHA256.test(input.bundleSha256)
        || !input.expectedHomeServerIdentityId.trim()
        || !input.expectedCanonicalServerUrl.trim()
        || !Number.isSafeInteger(input.sourceDescriptorRevision)
        || input.sourceDescriptorRevision < 1) {
        throw new Error('Invalid Personal Home relocation destination stage input.');
      }
      await params.ensureRuntime({ kind: 'personal-home', canonicalServerUrl: input.expectedCanonicalServerUrl });
      const upload = parseRelocationUpload(await destinationCommand([
        'stage',
        '--operation-id', input.operationId,
        '--prepare-upload',
      ]), input.operationId);
      let stagedFacts: PersonalHomeRelocationDestinationFacts | undefined;
      let stageFailure: unknown;
      try {
        try {
          copyLocalDirectoryToRemoteSync({
            target: ssh.target,
            port: ssh.port,
            sshConfigFile: ssh.sshConfigFile,
            knownHostsMode: knownHosts.mode,
            knownHostsPath: knownHosts.mode === 'app' ? knownHosts.path : undefined,
            auth,
            localPath: input.archivePath,
            remotePath: upload.uploadLocator,
            connectTimeoutSec: 10,
            errorPrefix: `Personal Home relocation archive transfer failed for ${ssh.target}`,
          });
        } catch (transferError) {
          const sanitizedTransferError = sanitizeRelocationTransferError(transferError, upload.uploadLocator);
          let cleanupConfirmed = false;
          try {
            const aborted = await remoteCommand([
              'abort',
              '--operation-id', input.operationId,
            ], input.operationId);
            cleanupConfirmed = (aborted.status === 'absent' || aborted.status === 'aborted')
              && aborted.transferCleanupNeedsAttention !== true;
          } catch {
            // The transfer failure remains primary. The typed wrapper below
            // carries only cleanup attention, never a remote path or a second
            // cleanup error, into the source relocation owner.
          }
          if (!cleanupConfirmed) {
            throw new PersonalHomeRelocationTransferCleanupError(sanitizedTransferError);
          }
          throw sanitizedTransferError;
        }
        try {
          const facts = await remoteCommand([
            'stage',
            '--operation-id', input.operationId,
            '--upload-receipt', upload.uploadReceipt,
            '--bundle-sha256', input.bundleSha256,
            '--expected-home-id', input.expectedHomeServerIdentityId,
            '--expected-canonical-server-url', input.expectedCanonicalServerUrl,
            '--source-descriptor-revision', String(input.sourceDescriptorRevision),
          ], input.operationId);
          if (facts.status === 'absent'
            || facts.bundleSha256 !== input.bundleSha256
            || facts.expectedHomeServerIdentityId !== input.expectedHomeServerIdentityId
            || facts.sourceDescriptorRevision !== input.sourceDescriptorRevision) {
            throw new Error('Remote Personal Home relocation stage returned facts for a different bundle.');
          }
          stagedFacts = facts;
        } catch (stageError) {
          try {
            const current = await status(input.operationId);
            if (current.status !== 'absent'
              && current.bundleSha256 === input.bundleSha256
              && current.expectedHomeServerIdentityId === input.expectedHomeServerIdentityId
              && current.sourceDescriptorRevision === input.sourceDescriptorRevision
              && (current.status === 'quarantined' || current.status === 'active')) {
              stagedFacts = current;
            } else {
              stageFailure = stageError;
            }
          } catch {
            // Preserve the stage error; the source coordinator may retry the idempotent status call.
            stageFailure = stageError;
          }
        }
      } catch (error) {
        stageFailure = error;
      }
      if (stageFailure) throw stageFailure;
      if (!stagedFacts) throw new Error('Remote Personal Home relocation stage did not return authoritative destination facts.');
      return stagedFacts;
    },
    commit: async (input) => {
      assertRelocationOperationId(input.operationId);
      const publishedDescriptor = HomeConnectionDescriptorV1Schema.parse(input.publishedDescriptor);
      return await remoteCommand([
        'commit',
        '--operation-id', input.operationId,
        '--published-descriptor-json', JSON.stringify(publishedDescriptor),
      ], input.operationId) as PersonalHomeRelocationDestinationFacts;
    },
    abort: async (operationId) => {
      assertRelocationOperationId(operationId);
      return await remoteCommand(['abort', '--operation-id', operationId], operationId);
    },
  });
}
