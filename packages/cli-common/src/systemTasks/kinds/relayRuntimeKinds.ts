import {
  HomeConnectionDescriptorV1Schema,
  SystemTaskJsonValueSchema,
  type HomeConnectionDescriptorV1,
  type SystemTaskJsonValue,
} from '@happier-dev/protocol';
import { normalizePublicReleaseRingLabel } from '@happier-dev/release-runtime/releaseRings';

import { SystemTaskExecutionError } from '../runSystemTask.js';
import { type InteractiveSystemTaskKind } from '../interactiveTaskKinds.js';
import {
  assertPersonalHomeEnvironmentKeys,
  parsePersonalHomeRuntimePurpose,
  type ManagedRelayPurpose,
} from '../../firstPartyRuntime/personalHome/personalHomeRuntimeSpec.js';
import type { PersonalHomeRuntimeLayout } from '../../firstPartyRuntime/personalHome/layout.js';
import type {
  PersonalHomeOperationContext,
  PersonalHomeOperations,
  PersonalHomeEraseConfirmationFacts,
  PersonalHomeRelocateInput,
} from '../../firstPartyRuntime/personalHome/operations.js';

export interface SystemTaskSshConnectionConfig {
  target: string;
  port?: number;
  auth: 'agent' | 'keyfile' | 'password';
  identityFile?: string;
  password?: string;
  sshConfigFile?: string;
  knownHostsPath?: string;
  trustedHostKey?: string;
}

export interface RelayRuntimeTaskParams {
  target: Readonly<{ kind: 'local' }> | Readonly<{ kind: 'ssh'; ssh: SystemTaskSshConnectionConfig }>;
  channel?: 'stable' | 'preview' | 'dev';
  mode?: 'user' | 'system';
  env?: Record<string, string>;
  selfHostRelayBinaryOverride?: string;
  purpose?: ManagedRelayPurpose;
}

export interface RelayRuntimeStatusSnapshot {
  installed: boolean;
  version: string | null;
  service: Readonly<{
    active: boolean | null;
    enabled: boolean | null;
  }>;
  baseUrl: string;
  healthy?: boolean | null;
  warnings?: readonly string[];
  purpose?: ManagedRelayPurpose;
  canonicalServerUrl?: string;
  layout?: PersonalHomeRuntimeLayout;
  dataPresent?: boolean;
  anonymousSignupEnabled?: boolean | null;
}

type RelayRuntimeStatusResult = Readonly<{
  installed: boolean;
  version: string | null;
  relayUrl: string;
  healthy: boolean;
  service: RelayRuntimeStatusSnapshot['service'];
  warnings?: readonly string[];
  purpose?: ManagedRelayPurpose;
  canonicalServerUrl?: string;
  layout?: PersonalHomeRuntimeLayout;
  dataPresent?: boolean;
  anonymousSignupEnabled?: boolean | null;
}>;

export type RelayRuntimeKindDeps = Readonly<{
  readStatus: (params: RelayRuntimeTaskParams) => Promise<RelayRuntimeStatusSnapshot>;
  checkHealth: (params: Readonly<{ baseUrl: string }>) => Promise<boolean>;
  installOrUpdate: (params: RelayRuntimeTaskParams) => Promise<Readonly<{ relayUrl: string; mode: 'user' | 'system' }>>;
  control: (params: RelayRuntimeTaskParams & Readonly<{ action: 'start' | 'stop' | 'restart' | 'uninstall' }>) => Promise<void>;
}>;

export type PersonalHomeTaskBaseParams = Readonly<{
  target: Readonly<{ kind: 'local' }>;
  purpose: Extract<ManagedRelayPurpose, { kind: 'personal-home' }>;
}>;

export const PERSONAL_HOME_SYSTEM_TASK_KINDS = Object.freeze({
  inspect: 'relay.runtime.personal_home.inspect.v1',
  backup: 'relay.runtime.personal_home.backup.v1',
  verifyBackup: 'relay.runtime.personal_home.verify_backup.v1',
  restore: 'relay.runtime.personal_home.restore.v1',
  erase: 'relay.runtime.personal_home.erase.v1',
  relocate: 'relay.runtime.personal_home.relocate.v1',
} as const);

export const PERSONAL_HOME_SYSTEM_TASK_KIND_IDS = Object.freeze(Object.values(PERSONAL_HOME_SYSTEM_TASK_KINDS));

export type PersonalHomeBackupTaskInput = Readonly<{ outputPath?: string; intent?: 'standard' | 'erase-safety' }>;
export type PersonalHomeVerifyBackupTaskInput = Readonly<{ archivePath: string }>;
export type PersonalHomeRestoreTaskInput =
  | Readonly<{ action?: 'restore'; archivePath: string; confirmOverwrite?: true; expectedHomeServerIdentityId?: string }>
  | Readonly<{ action: 'recover' | 'finalize' }>;
export type PersonalHomeEraseTaskInput = Readonly<Record<never, never>>;
export type PersonalHomeRelocateTaskInput = Readonly<{
  destination: Readonly<{
    targetId: string;
    descriptor: HomeConnectionDescriptorV1;
  }>;
}>;

export type PersonalHomeInspectTaskParams = PersonalHomeTaskBaseParams;
export type PersonalHomeBackupTaskParams = PersonalHomeTaskBaseParams & PersonalHomeBackupTaskInput;
export type PersonalHomeVerifyBackupTaskParams = PersonalHomeTaskBaseParams & PersonalHomeVerifyBackupTaskInput;
export type PersonalHomeRestoreTaskParams = PersonalHomeTaskBaseParams & PersonalHomeRestoreTaskInput;
export type PersonalHomeEraseTaskParams = PersonalHomeTaskBaseParams;
export type PersonalHomeRelocateTaskParams = PersonalHomeTaskBaseParams & PersonalHomeRelocateTaskInput;

export type PersonalHomeSystemTaskParamsByKind = Readonly<{
  [PERSONAL_HOME_SYSTEM_TASK_KINDS.inspect]: PersonalHomeInspectTaskParams;
  [PERSONAL_HOME_SYSTEM_TASK_KINDS.backup]: PersonalHomeBackupTaskParams;
  [PERSONAL_HOME_SYSTEM_TASK_KINDS.verifyBackup]: PersonalHomeVerifyBackupTaskParams;
  [PERSONAL_HOME_SYSTEM_TASK_KINDS.restore]: PersonalHomeRestoreTaskParams;
  [PERSONAL_HOME_SYSTEM_TASK_KINDS.erase]: PersonalHomeEraseTaskParams;
  [PERSONAL_HOME_SYSTEM_TASK_KINDS.relocate]: PersonalHomeRelocateTaskParams;
}>;

/**
 * The task-facing view of the canonical PersonalHomeOperations instance. It intentionally omits
 * archive, lifecycle, transfer, publication, and filesystem callbacks: production composition
 * supplies those once, while task callers provide only operation facts.
 */
export type PersonalHomeSystemTaskOperations = Readonly<{
  inspect(context: PersonalHomeTaskOperationContext): Promise<SystemTaskJsonValue>;
  backup(input: PersonalHomeBackupTaskInput & PersonalHomeTaskOperationContext): Promise<SystemTaskJsonValue>;
  verifyBackup(input: PersonalHomeVerifyBackupTaskInput & PersonalHomeTaskOperationContext): Promise<SystemTaskJsonValue>;
  restore(input: Exclude<PersonalHomeRestoreTaskInput, Readonly<{ action: 'recover' | 'finalize' }>> & PersonalHomeTaskOperationContext): Promise<SystemTaskJsonValue>;
  recoverRestore(context: PersonalHomeTaskOperationContext): Promise<SystemTaskJsonValue>;
  finalizeRestore(context: PersonalHomeTaskOperationContext): Promise<SystemTaskJsonValue>;
  erase(context: PersonalHomeTaskOperationContext): Promise<SystemTaskJsonValue>;
  relocate(input: PersonalHomeRelocateTaskInput & PersonalHomeTaskOperationContext): Promise<SystemTaskJsonValue>;
}>;

export type PersonalHomeTaskOperationContext = Readonly<{
  signal?: AbortSignal;
  progress(stepId: string, message?: string): void;
  requestedPurpose: Extract<ManagedRelayPurpose, { kind: 'personal-home' }>;
  confirm?(facts: PersonalHomeEraseConfirmationFacts): Promise<boolean>;
}>;

export type PersonalHomeTaskKindDeps = Readonly<{
  operations?: PersonalHomeSystemTaskOperations;
}>;

const PERSONAL_HOME_DOMAIN_ERROR_CODES: ReadonlySet<string> = new Set([
  'purpose_not_personal_home',
  'identity_unavailable',
  'sqlite_maintenance_required',
  'home_stop_failed',
  'relocation_unavailable',
  'restore_unavailable',
  'destination_not_empty',
  'identity_mismatch',
  'schema_unsupported',
  'insufficient_space',
  'restore_failed',
  'recovery_required',
  'restore_recovery_required',
  'confirmation_required',
  'unsafe_data_root',
  'operation_in_progress',
  'ambiguous_stale_lock',
  'sqlite_snapshot_unstable',
  'sqlite_check_failed',
  'invalid_archive',
  'hash_mismatch',
  'unsupported_archive',
]);

function translatePersonalHomeDomainError(error: unknown): never {
  if (error instanceof SystemTaskExecutionError) throw error;
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const code = String(error.code);
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    if (code === 'operation_cancelled') {
      throw new SystemTaskExecutionError('cancelled', message || 'Personal Home operation was cancelled.');
    }
    if (PERSONAL_HOME_DOMAIN_ERROR_CODES.has(code)) {
      throw new SystemTaskExecutionError(code, message || 'Personal Home operation failed.');
    }
  }
  throw error;
}

export function createPersonalHomeSystemTaskOperations(params: Readonly<{
  operations: PersonalHomeOperations;
  restoreAvailability?: 'available' | 'unavailable';
  resolveRelocationInput?: (
    destination: PersonalHomeRelocateTaskInput['destination'],
  ) => Promise<Omit<PersonalHomeRelocateInput, keyof PersonalHomeOperationContext>>;
}>): PersonalHomeSystemTaskOperations {
  const result = async (value: Promise<unknown>): Promise<SystemTaskJsonValue> => {
    try {
      return SystemTaskJsonValueSchema.parse(await value);
    } catch (error) {
      translatePersonalHomeDomainError(error);
    }
  };
  const ownerContext = (context: PersonalHomeTaskOperationContext): PersonalHomeOperationContext => ({
    ...(context.signal ? { signal: context.signal } : {}),
    progress: context.progress,
    expectedCanonicalServerUrl: context.requestedPurpose.canonicalServerUrl,
  });
  return Object.freeze({
    inspect: async (context) => await result(params.operations.inspect(ownerContext(context))),
    backup: async (input) => await result(params.operations.backup({
        ...(input.outputPath === undefined ? {} : { outputPath: input.outputPath }),
        ...(input.intent === undefined ? {} : { intent: input.intent }),
        ...ownerContext(input),
      })),
    verifyBackup: async (input) => await result(params.operations.verifyBackup({ archivePath: input.archivePath, ...ownerContext(input) })),
    restore: async (input) => {
      if (params.restoreAvailability === 'unavailable') {
        throw new SystemTaskExecutionError(
          'unsupported',
          'Personal Home restore is unavailable because this runtime has no authoritative backup schema compatibility frontier.',
        );
      }
      return await result(params.operations.restore({
        archivePath: input.archivePath,
        confirmOverwrite: input.confirmOverwrite === true,
        ...(input.expectedHomeServerIdentityId ? { expectedHomeServerIdentityId: input.expectedHomeServerIdentityId } : {}),
        ...ownerContext(input),
      }));
    },
    recoverRestore: async (context) => await result(params.operations.recoverRestore(ownerContext(context))),
    finalizeRestore: async (context) => await result(params.operations.finalizeRestore(ownerContext(context))),
    erase: async (context) => {
      if (!context.confirm) throw new SystemTaskExecutionError('confirmation_required', 'Personal Home erase confirmation is unavailable.');
      return await result(params.operations.erase({ confirm: context.confirm, ...ownerContext(context) }));
    },
    relocate: async (input) => {
      if (!params.resolveRelocationInput) {
        throw new SystemTaskExecutionError('unsupported', 'Personal Home relocation target resolution is unavailable.');
      }
      const resolved = await params.resolveRelocationInput(input.destination);
      return await result(params.operations.relocate({
        ...resolved,
        ...ownerContext(input),
      }));
    },
  });
}

export function createDeferredPersonalHomeSystemTaskOperations(
  load: () => Promise<PersonalHomeSystemTaskOperations>,
): PersonalHomeSystemTaskOperations {
  let pending: Promise<PersonalHomeSystemTaskOperations> | null = null;
  const operations = (): Promise<PersonalHomeSystemTaskOperations> => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  return Object.freeze({
    inspect: async (context) => await (await operations()).inspect(context),
    backup: async (input) => await (await operations()).backup(input),
    verifyBackup: async (input) => await (await operations()).verifyBackup(input),
    restore: async (input) => await (await operations()).restore(input),
    recoverRestore: async (input) => await (await operations()).recoverRestore(input),
    finalizeRestore: async (input) => await (await operations()).finalizeRestore(input),
    erase: async (input) => await (await operations()).erase(input),
    relocate: async (input) => await (await operations()).relocate(input),
  });
}

const PERSONAL_HOME_BASE_KEYS = ['target', 'purpose'] as const;

export function createPersonalHomeInspectTaskKind(deps: PersonalHomeTaskKindDeps): InteractiveSystemTaskKind<SystemTaskJsonValue> {
  return createPersonalHomeTaskKind(deps, PERSONAL_HOME_BASE_KEYS, async (operations, _value, context) => await operations.inspect(context));
}

export function createPersonalHomeBackupTaskKind(deps: PersonalHomeTaskKindDeps): InteractiveSystemTaskKind<SystemTaskJsonValue> {
  return createPersonalHomeTaskKind(deps, [...PERSONAL_HOME_BASE_KEYS, 'outputPath', 'intent'], async (operations, value, context) => {
    if (value.intent !== undefined && value.intent !== 'standard' && value.intent !== 'erase-safety') {
      throw new SystemTaskExecutionError('invalid_params', 'Invalid Personal Home backup intent.');
    }
    return await operations.backup({
      ...(value.outputPath === undefined ? {} : { outputPath: parseNonEmptyString(value.outputPath, 'outputPath') }),
      ...(value.intent === undefined ? {} : { intent: value.intent }),
      ...context,
    });
  });
}

export function createPersonalHomeVerifyBackupTaskKind(deps: PersonalHomeTaskKindDeps): InteractiveSystemTaskKind<SystemTaskJsonValue> {
  return createPersonalHomeTaskKind(deps, [...PERSONAL_HOME_BASE_KEYS, 'archivePath'], async (operations, value, context) =>
    await operations.verifyBackup({ archivePath: parseNonEmptyString(value.archivePath, 'archivePath'), ...context }));
}

export function createPersonalHomeRestoreTaskKind(deps: PersonalHomeTaskKindDeps): InteractiveSystemTaskKind<SystemTaskJsonValue> {
  return createPersonalHomeTaskKind(
    deps,
    [...PERSONAL_HOME_BASE_KEYS, 'action', 'archivePath', 'confirmOverwrite', 'expectedHomeServerIdentityId'],
    async (operations, value, context) => {
      if (value.action === 'recover' || value.action === 'finalize') {
        if (value.archivePath !== undefined || value.confirmOverwrite !== undefined || value.expectedHomeServerIdentityId !== undefined) {
          throw new SystemTaskExecutionError('invalid_params', 'Restore recovery and finalization do not accept archive or overwrite fields.');
        }
        return value.action === 'recover'
          ? await operations.recoverRestore(context)
          : await operations.finalizeRestore(context);
      }
      if (value.action !== undefined && value.action !== 'restore') {
        throw new SystemTaskExecutionError('invalid_params', 'Invalid restore action.');
      }
      if (value.confirmOverwrite !== undefined && value.confirmOverwrite !== true) {
        throw new SystemTaskExecutionError('invalid_params', 'Restore overwrite confirmation must be true when provided.');
      }
      return await operations.restore({
        ...(value.action === 'restore' ? { action: 'restore' as const } : {}),
        archivePath: parseNonEmptyString(value.archivePath, 'archivePath'),
        ...(value.confirmOverwrite === true ? { confirmOverwrite: true as const } : {}),
        ...(value.expectedHomeServerIdentityId === undefined
          ? {}
          : { expectedHomeServerIdentityId: parseNonEmptyString(value.expectedHomeServerIdentityId, 'expectedHomeServerIdentityId') }),
        ...context,
      });
    },
  );
}

export function createPersonalHomeEraseTaskKind(deps: PersonalHomeTaskKindDeps): InteractiveSystemTaskKind<SystemTaskJsonValue> {
  return createPersonalHomeTaskKind(deps, PERSONAL_HOME_BASE_KEYS, async (operations, _value, context) =>
    await operations.erase(context));
}

export function createPersonalHomeRelocateTaskKind(deps: PersonalHomeTaskKindDeps): InteractiveSystemTaskKind<SystemTaskJsonValue> {
  return createPersonalHomeTaskKind(deps, [...PERSONAL_HOME_BASE_KEYS, 'destination'], async (operations, value, context) => {
    if (!isRecord(value.destination)) {
      throw new SystemTaskExecutionError('invalid_params', 'Missing relocation destination.');
    }
    assertOnlyKeys(value.destination, ['targetId', 'descriptor']);
    const descriptor = HomeConnectionDescriptorV1Schema.safeParse(value.destination.descriptor);
    if (!descriptor.success) {
      throw new SystemTaskExecutionError('invalid_params', 'Invalid relocation destination descriptor.');
    }
    return await operations.relocate({
      destination: {
        targetId: parseNonEmptyString(value.destination.targetId, 'destination.targetId'),
        descriptor: descriptor.data,
      },
      ...context,
    });
  });
}

function createPersonalHomeTaskKind(
  deps: PersonalHomeTaskKindDeps,
  allowedKeys: readonly string[],
  invoke: (
    operations: PersonalHomeSystemTaskOperations,
    value: Record<string, unknown>,
    context: PersonalHomeTaskOperationContext,
  ) => Promise<SystemTaskJsonValue>,
): InteractiveSystemTaskKind<SystemTaskJsonValue> {
  return {
    async run(ctx) {
      const value = parsePersonalHomeTaskBase(ctx.params, allowedKeys);
      if (ctx.signal?.aborted) {
        throw new SystemTaskExecutionError('cancelled', 'System task execution was cancelled.');
      }
      if (!deps.operations) {
        throw new SystemTaskExecutionError('unsupported', 'Personal Home operations are unavailable.');
      }
      return await invoke(deps.operations, value, {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        progress: (stepId, message) => ctx.emit({
          type: 'progress',
          stepId: `personal_home.${stepId}`,
          ...(message ? { message } : {}),
        }),
        requestedPurpose: value.purpose,
        confirm: async (facts) => {
          const answer = await ctx.prompt({
            kind: 'personal_home.confirm_erase.v1',
            stepId: 'personal_home.confirm_erase',
            message: 'Confirm permanent deletion of these Personal Home paths.',
            data: {
              canonicalServerUrl: facts.canonicalServerUrl,
              homeServerIdentityId: facts.homeServerIdentityId,
              paths: [...facts.paths],
              estimatedBytes: facts.estimatedBytes,
            },
          });
          return isExactEraseConfirmation(answer);
        },
      });
    },
  };
}

function isExactEraseConfirmation(value: unknown): boolean {
  return isRecord(value)
    && Object.keys(value).length === 1
    && value.confirmed === true;
}

function parsePersonalHomeTaskBase(params: unknown, allowedKeys: readonly string[]): Record<string, unknown> & PersonalHomeTaskBaseParams {
  if (!isRecord(params)) {
    throw new SystemTaskExecutionError('invalid_params', 'Personal Home task params must be an object.');
  }
  if (!isRecord(params.target)) {
    throw new SystemTaskExecutionError('invalid_params', 'Invalid Personal Home runtime target.');
  }
  if (params.target.kind === 'ssh') {
    throw new SystemTaskExecutionError('unsupported', 'Personal Home data operations do not support SSH targets.');
  }
  assertOnlyKeys(params, allowedKeys);
  assertOnlyKeys(params.target, ['kind']);
  if (params.target.kind !== 'local') {
    throw new SystemTaskExecutionError('invalid_params', 'Personal Home data operations require a local target.');
  }
  let purpose: ReturnType<typeof parsePersonalHomeRuntimePurpose>;
  try {
    purpose = parsePersonalHomeRuntimePurpose(params.purpose);
  } catch {
    throw new SystemTaskExecutionError('invalid_params', 'Invalid Personal Home runtime purpose.');
  }
  return {
    ...params,
    target: { kind: 'local' },
    purpose: { kind: 'personal-home', canonicalServerUrl: purpose.canonicalServerUrl },
  };
}

function assertOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new SystemTaskExecutionError('invalid_params', `Unknown Personal Home task param: ${unknownKey}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseNonEmptyString(value: unknown, field: string): string {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed) {
    throw new SystemTaskExecutionError('invalid_params', `Missing ${field}.`);
  }
  return parsed;
}

export function createRelayRuntimeStatusTaskKind(deps: Pick<RelayRuntimeKindDeps, 'readStatus' | 'checkHealth'>): InteractiveSystemTaskKind<RelayRuntimeStatusResult> {
  return {
    async run(ctx) {
      const parsed = parseRelayRuntimeTaskParams(ctx.params);

      ctx.emit({
        type: 'progress',
        stepId: 'relay.status.inspect',
        message: 'Inspecting relay runtime',
      });

      const snapshot = await deps.readStatus(parsed);

      ctx.emit({
        type: 'progress',
        stepId: 'relay.status.health',
        message: 'Checking relay runtime health',
      });

      return await buildRelayRuntimeStatusResult(snapshot, deps.checkHealth);
    },
  };
}

export function createRelayRuntimeInstallOrUpdateTaskKind(deps: Pick<RelayRuntimeKindDeps, 'installOrUpdate'>): InteractiveSystemTaskKind<Readonly<{ relayUrl: string; mode: 'user' | 'system' }>> {
  return {
    async run(ctx) {
      const parsed = parseRelayRuntimeTaskParams(ctx.params);

      ctx.emit({
        type: 'progress',
        stepId: 'relay.install',
        message: 'Installing relay runtime',
      });

      return await deps.installOrUpdate(parsed);
    },
  };
}

export function createRelayRuntimeStartTaskKind(deps: Pick<RelayRuntimeKindDeps, 'control' | 'readStatus' | 'checkHealth'>): InteractiveSystemTaskKind<RelayRuntimeStatusResult> {
  return {
    async run(ctx) {
      const parsed = parseRelayRuntimeTaskParams(ctx.params);

      ctx.emit({
        type: 'progress',
        stepId: 'relay.start',
        message: 'Starting relay runtime',
      });

      await deps.control({
        ...parsed,
        action: 'start',
      });

      ctx.emit({
        type: 'progress',
        stepId: 'relay.status.inspect',
        message: 'Inspecting relay runtime',
      });

      const snapshot = await deps.readStatus(parsed);

      ctx.emit({
        type: 'progress',
        stepId: 'relay.status.health',
        message: 'Checking relay runtime health',
      });

      return await buildRelayRuntimeStatusResult(snapshot, deps.checkHealth);
    },
  };
}

export function createRelayRuntimeRestartTaskKind(deps: Pick<RelayRuntimeKindDeps, 'control' | 'readStatus' | 'checkHealth'>): InteractiveSystemTaskKind<RelayRuntimeStatusResult> {
  return {
    async run(ctx) {
      const parsed = parseRelayRuntimeTaskParams(ctx.params);
      ctx.emit({ type: 'progress', stepId: 'relay.restart', message: 'Restarting relay runtime' });
      await deps.control({ ...parsed, action: 'restart' });
      const snapshot = await deps.readStatus(parsed);
      ctx.emit({ type: 'progress', stepId: 'relay.status.health', message: 'Checking relay runtime health' });
      return await buildRelayRuntimeStatusResult(snapshot, deps.checkHealth);
    },
  };
}

export function createRelayRuntimeStopTaskKind(deps: Pick<RelayRuntimeKindDeps, 'control'>): InteractiveSystemTaskKind<Readonly<{ stopped: true }>> {
  return {
    async run(ctx) {
      const parsed = parseRelayRuntimeTaskParams(ctx.params);

      ctx.emit({
        type: 'progress',
        stepId: 'relay.stop',
        message: 'Stopping relay runtime',
      });

      await deps.control({
        ...parsed,
        action: 'stop',
      });

      return {
        stopped: true,
      };
    },
  };
}

export function createRelayRuntimeUninstallTaskKind(deps: Pick<RelayRuntimeKindDeps, 'control'>): InteractiveSystemTaskKind<Readonly<{ uninstalled: true }>> {
  return {
    async run(ctx) {
      const parsed = parseRelayRuntimeTaskParams(ctx.params);

      ctx.emit({
        type: 'progress',
        stepId: 'relay.uninstall',
        message: 'Uninstalling relay runtime',
      });

      await deps.control({
        ...parsed,
        action: 'uninstall',
      });

      return {
        uninstalled: true,
      };
    },
  };
}

async function buildRelayRuntimeStatusResult(
  snapshot: RelayRuntimeStatusSnapshot,
  checkHealth: (params: Readonly<{ baseUrl: string }>) => Promise<boolean>,
): Promise<RelayRuntimeStatusResult> {
  const healthy = typeof snapshot.healthy === 'boolean'
    ? snapshot.healthy
    : await checkHealth({ baseUrl: snapshot.baseUrl });

  return {
    installed: snapshot.installed,
    version: snapshot.version,
    relayUrl: snapshot.baseUrl,
    healthy,
    service: snapshot.service,
    ...(snapshot.warnings && snapshot.warnings.length > 0 ? { warnings: snapshot.warnings } : {}),
    ...(snapshot.purpose ? { purpose: snapshot.purpose } : {}),
    ...(snapshot.canonicalServerUrl ? { canonicalServerUrl: snapshot.canonicalServerUrl } : {}),
    ...(snapshot.layout ? { layout: snapshot.layout } : {}),
    ...(typeof snapshot.dataPresent === 'boolean' ? { dataPresent: snapshot.dataPresent } : {}),
    ...(snapshot.anonymousSignupEnabled !== undefined
      ? { anonymousSignupEnabled: snapshot.anonymousSignupEnabled }
      : {}),
  };
}

export function parseRelayRuntimeTaskParams(params: unknown): RelayRuntimeTaskParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new SystemTaskExecutionError('invalid_params', 'Invalid relay runtime params.');
  }
  const value = params as Record<string, unknown>;
  const target = value.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new SystemTaskExecutionError('invalid_params', 'Invalid relay runtime target.');
  }

  const targetRecord = target as Record<string, unknown>;
  const kind = targetRecord.kind === 'ssh' ? 'ssh' : 'local';
  const channel = normalizePublicReleaseRingLabel(value.channel) || 'stable';
  const mode = value.mode === 'system' ? 'system' : 'user';
  const env = typeof value.env === 'object' && value.env && !Array.isArray(value.env)
    ? Object.fromEntries(Object.entries(value.env as Record<string, unknown>).map(([key, innerValue]) => [key, String(innerValue ?? '')]))
    : undefined;
  const selfHostRelayBinaryOverride = typeof value.selfHostRelayBinaryOverride === 'string'
    ? value.selfHostRelayBinaryOverride
    : undefined;
  let purpose: ManagedRelayPurpose | undefined;
  try {
    purpose = value.purpose === undefined
      ? undefined
      : (() => {
          const spec = parsePersonalHomeRuntimePurpose(value.purpose);
          return { kind: 'personal-home' as const, canonicalServerUrl: spec.canonicalServerUrl };
        })();
    if (purpose?.kind === 'personal-home') {
      assertPersonalHomeEnvironmentKeys(env ?? {});
      if (kind === 'ssh') {
        throw new SystemTaskExecutionError(
          'unsupported',
          'Personal Home runtime does not support SSH targets.',
        );
      }
    }
  } catch (error) {
    if (error instanceof SystemTaskExecutionError) throw error;
    throw new SystemTaskExecutionError(
      'invalid_params',
      error instanceof Error ? error.message : 'Invalid Personal Home runtime parameters.',
    );
  }

  return {
    target: kind === 'local'
      ? { kind: 'local' }
      : {
          kind: 'ssh',
          ssh: parseSystemTaskSshConfig(targetRecord.ssh),
        },
    channel,
    mode,
    ...(env ? { env } : {}),
    ...(selfHostRelayBinaryOverride ? { selfHostRelayBinaryOverride } : {}),
    ...(purpose ? { purpose } : {}),
  };
}

export function parseSystemTaskSshConfig(value: unknown): SystemTaskSshConnectionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SystemTaskExecutionError('invalid_params', 'Invalid ssh config.');
  }
  const record = value as Record<string, unknown>;
  const auth = record.auth === 'keyfile'
    ? 'keyfile'
    : record.auth === 'password'
      ? 'password'
      : 'agent';
  return {
    target: ensureNonEmptyString(record.target, 'ssh.target'),
    ...(typeof record.port === 'number' ? { port: record.port } : {}),
    auth,
    ...(typeof record.identityFile === 'string' ? { identityFile: record.identityFile } : {}),
    ...(typeof record.password === 'string' ? { password: record.password } : {}),
    ...(typeof record.sshConfigFile === 'string' ? { sshConfigFile: record.sshConfigFile } : {}),
    ...(typeof record.knownHostsPath === 'string' ? { knownHostsPath: record.knownHostsPath } : {}),
    ...(typeof record.trustedHostKey === 'string' ? { trustedHostKey: record.trustedHostKey } : {}),
  };
}

function ensureNonEmptyString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new SystemTaskExecutionError('invalid_params', `Missing ${field}.`);
  }
  return text;
}
