import type {
  WorkflowAuthoredProducerRef,
  WorkflowWorkspaceCreationIntentV1,
  WorkflowWorkspaceDescriptorV1,
  WorkflowWorkspaceResolutionV1,
  WorkflowWorkspaceSelection,
  WorkflowAcceptedWorkspaceTargetV1,
  WorkflowProjectTargetV1,
} from '@happier-dev/protocol/workflows';
import type { WorkflowDefinitionV1, WorkflowProgressEnvelopeV1, WorkflowStep, WorkflowWorkspaceProgressV1 } from '@happier-dev/protocol';
import type { WorkspaceRefV1 } from '@happier-dev/protocol';
import { realpath, stat } from 'node:fs/promises';

import { getPathRemainderWithinBase } from '@/session/handoff/paths/sessionHandoffPathNormalization';
import { inspectWorkspaceLocationWithScmWorkspace } from '@/scm/workspace/workspaceLocationInspection';
import { realizeWorkspaceCheckoutWithScmWorkspaceSource } from '@/scm/workspace/workspaceCheckoutOperations';
import { resolveSessionDirectoryInCheckout } from '@/session/creation/prepareSessionCreationTarget';
import {
  canonicalAbsolutePathsEqual,
  resolveCanonicalAbsolutePath,
} from '@/utils/path/expandHomeDirPath';
import {
  workflowInvocationKey,
  type WorkflowConversationWorkspace,
  type WorkflowCoordinatorInvocation,
  type WorkflowCoordinatorStore,
} from './coordinator';

export type WorkflowWorkspaceDescriptor = WorkflowWorkspaceDescriptorV1;
export type WorkflowWorkspaceCreationIntent = WorkflowWorkspaceCreationIntentV1;
export type WorkflowWorkspaceResolution = WorkflowWorkspaceResolutionV1;
export type WorkflowWorkspaceRestoreResult = Readonly<{ ok: true }> | Readonly<{
  ok: false;
  code: 'workflow_workspace_restore_unavailable' | 'workflow_workspace_restore_failed';
}>;

export type WorkflowAcceptedWorkspaceTargetPreparation =
  | Readonly<{ ok: true; workspaceTarget: WorkflowAcceptedWorkspaceTargetV1 }>
  | Readonly<{ ok: false; code: 'workspace_unavailable' | 'workspace_conflict' | 'committed_revision_unavailable' }>;

type Dependencies = Readonly<{
  resolveProducerWorkspace?: (producer: WorkflowAuthoredProducerRef) => Promise<WorkflowWorkspaceDescriptor | null>;
  inspectCommittedRevision?: (directory: string) => Promise<string | null>;
  realizeWorktree?: (intent: WorkflowWorkspaceCreationIntent) => Promise<Readonly<{ directory: string; checkoutRootPath: string; branchName: string }> | null>;
  persistCreationIntent?: (intent: WorkflowWorkspaceCreationIntent) => Promise<void>;
  persistWorkspace?: (workspace: WorkflowWorkspaceDescriptor) => Promise<void>;
  verifyRecordedWorkspace?: (
    workspace: WorkflowWorkspaceDescriptor,
    creationIntent?: WorkflowWorkspaceCreationIntent,
  ) => Promise<'available' | 'missing' | 'conflict'>;
}>;

function sameWorkspace(left: WorkflowConversationWorkspace, right: WorkflowConversationWorkspace): boolean {
  return left.machineId === right.machineId
    && getPathRemainderWithinBase(left.directory, right.directory) === '';
}

function creationDisplayName(runId: string, logicalInvocationRecordId: string): string {
  return `workflow-${runId}-${logicalInvocationRecordId}`;
}

async function canonicalExistingPathsEqual(left: string, right: string): Promise<boolean> {
  const canonicalize = async (path: string) => {
    try {
      return await realpath(path);
    } catch {
      return path;
    }
  };
  return canonicalAbsolutePathsEqual(await canonicalize(left), await canonicalize(right));
}

async function inspectCommittedRevision(directory: string): Promise<string | null> {
  const inspected = await inspectWorkspaceLocationWithScmWorkspace({ candidatePath: directory });
  return inspected?.inspection.committedRevision ?? null;
}

/**
 * Revalidates an accepted/recorded descriptor immediately before it can feed a
 * workflow filesystem or agent effect. A normal directory remains usable when
 * no SCM owns it; an SCM-backed descriptor must still resolve to its accepted
 * checkout root.
 */
export async function verifyWorkflowWorkspaceCurrentness(
  workspace: WorkflowWorkspaceDescriptor,
  input: Readonly<{
    creationIntent?: WorkflowWorkspaceCreationIntent;
    pathIsDirectory?: (path: string) => Promise<boolean>;
    inspectLocation?: (input: Readonly<{ candidatePath: string }>) => Promise<Readonly<{
      backendId?: string;
      inspection: Readonly<{ rootPath: string }>;
      checkoutDiscovery?: readonly Readonly<{
        kind: string;
        path?: string;
        repositoryIdentityPath?: string;
      }>[];
    }> | null>;
  }> = {},
): Promise<'available' | 'missing' | 'conflict'> {
  const pathIsDirectory = input.pathIsDirectory ?? (async (path: string) => {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  });
  if (!await pathIsDirectory(workspace.directory)) return 'missing';
  const inspected = await (input.inspectLocation ?? inspectWorkspaceLocationWithScmWorkspace)({
    candidatePath: workspace.directory,
  });
  if (!inspected) return workspace.checkout ? 'conflict' : 'available';
  if (!await canonicalExistingPathsEqual(
    inspected.inspection.rootPath,
    workspace.checkoutRootPath,
  )) return 'conflict';
  if (!workspace.checkout) return 'available';
  if (getPathRemainderWithinBase(workspace.directory, workspace.checkoutRootPath) === null) return 'conflict';

  let checkout: NonNullable<typeof inspected.checkoutDiscovery>[number] | undefined;
  for (const candidate of inspected.checkoutDiscovery ?? []) {
    if (candidate.kind === workspace.checkout.kind
      && candidate.path !== undefined
      && candidate.repositoryIdentityPath !== undefined
      && await canonicalExistingPathsEqual(candidate.path, workspace.checkoutRootPath)) {
      checkout = candidate;
      break;
    }
  }
  if (!checkout?.repositoryIdentityPath || !input.creationIntent) return 'conflict';
  const source = await (input.inspectLocation ?? inspectWorkspaceLocationWithScmWorkspace)({
    candidatePath: input.creationIntent.sourceDirectory,
  });
  const sourceCheckout = source?.checkoutDiscovery?.find((candidate) => (
    candidate.kind === workspace.checkout?.kind && candidate.repositoryIdentityPath !== undefined
  ));
  return source?.backendId !== undefined
    && inspected.backendId !== undefined
    && source.backendId === inspected.backendId
    && sourceCheckout?.repositoryIdentityPath !== undefined
    && await canonicalExistingPathsEqual(sourceCheckout.repositoryIdentityPath, checkout.repositoryIdentityPath)
    ? 'available'
    : 'conflict';
}

function workflowUsesOriginalCommittedRevision(definition: WorkflowDefinitionV1): boolean {
  const selectionUsesOriginal = (selection: WorkflowWorkspaceSelection | undefined) => (
    selection?.kind === 'new_worktree' && selection.source.kind === 'original'
  );
  if (selectionUsesOriginal(definition.defaults.workspace)) return true;
  const visit = (blocks: WorkflowDefinitionV1['blocks']): boolean => blocks.some((block) => {
    if (block.kind === 'step') return selectionUsesOriginal(block.execution?.workspace);
    if (block.kind === 'parallel') return block.branches.some((branch) => visit(branch.blocks));
    if (block.kind === 'if') return visit(block.then) || visit(block.otherwise);
    return visit(block.body)
      || (block.repetition.kind === 'evaluate'
        && selectionUsesOriginal(block.repetition.evaluator.execution?.workspace));
  });
  return visit(definition.blocks);
}

/** Canonicalizes only the signed target fields; it performs no filesystem effect. */
export function normalizeWorkflowProjectTarget(input: Readonly<{
  projectTarget: WorkflowProjectTargetV1;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}>): WorkflowProjectTargetV1 | null {
  const canonical = resolveCanonicalAbsolutePath(input.projectTarget.directory, {
    env: input.env,
    platform: input.platform,
  });
  if (!canonical) return null;
  return {
    machineId: input.projectTarget.machineId,
    directory: canonical.path,
    ...(input.projectTarget.workspaceRefId
      ? { workspaceRefId: input.projectTarget.workspaceRefId }
      : {}),
  };
}

/**
 * Resolves the selected project on the exact target daemon before the accepted
 * Run snapshot is sealed. Definitions remain portable; the resulting absolute
 * path/root and optional original Git revision do not.
 */
export async function prepareWorkflowAcceptedWorkspaceTarget(input: Readonly<{
  projectTarget: WorkflowProjectTargetV1;
  definition: WorkflowDefinitionV1;
  currentServerId?: string;
  resolveWorkspaceRef?: (workspaceRefId: string) => WorkspaceRefV1 | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  inspectLocation?: (input: Readonly<{ candidatePath: string }>) => Promise<Readonly<{
    inspection: Readonly<{ rootPath: string; committedRevision?: string }>;
  }> | null>;
  pathIsDirectory?: (path: string) => Promise<boolean>;
}>): Promise<WorkflowAcceptedWorkspaceTargetPreparation> {
  const normalizedTarget = normalizeWorkflowProjectTarget({
    projectTarget: input.projectTarget,
    env: input.env,
    platform: input.platform,
  });
  if (!normalizedTarget) return { ok: false, code: 'workspace_unavailable' };
  const pathIsDirectory = input.pathIsDirectory ?? (async (path: string) => {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  });
  if (!await pathIsDirectory(normalizedTarget.directory)) return { ok: false, code: 'workspace_unavailable' };

  const inspected = await (input.inspectLocation ?? inspectWorkspaceLocationWithScmWorkspace)({
    candidatePath: normalizedTarget.directory,
  });
  if (input.projectTarget.workspaceRefId) {
    const workspaceRef = input.resolveWorkspaceRef?.(input.projectTarget.workspaceRefId) ?? null;
    if (!workspaceRef
      || (input.currentServerId !== undefined && workspaceRef.serverId !== input.currentServerId)
      || workspaceRef.machineId !== input.projectTarget.machineId
      || !inspected
      || getPathRemainderWithinBase(workspaceRef.rootPath, inspected.inspection.rootPath) !== '') {
      return { ok: false, code: 'workspace_conflict' };
    }
  }
  const project: WorkflowWorkspaceDescriptor = {
    machineId: input.projectTarget.machineId,
    directory: normalizedTarget.directory,
    checkoutRootPath: inspected?.inspection.rootPath ?? normalizedTarget.directory,
    ...(input.projectTarget.workspaceRefId ? { workspaceRefId: input.projectTarget.workspaceRefId } : {}),
  };
  if (!workflowUsesOriginalCommittedRevision(input.definition)) {
    return { ok: true, workspaceTarget: { project } };
  }
  const originalCommittedRevision = inspected?.inspection.committedRevision;
  return originalCommittedRevision
    ? { ok: true, workspaceTarget: { project, originalCommittedRevision } }
    : { ok: false, code: 'committed_revision_unavailable' };
}

async function realizeWorktree(intent: WorkflowWorkspaceCreationIntent): Promise<Readonly<{
  directory: string;
  checkoutRootPath: string;
  branchName: string;
}> | null> {
  const realized = await realizeWorkspaceCheckoutWithScmWorkspaceSource({
    sourcePath: intent.sourceDirectory,
    checkoutCreation: intent,
  });
  if (!realized) return null;
  return {
    directory: await resolveSessionDirectoryInCheckout({
      sourceDirectory: intent.sourceDirectory,
      sourceRootPath: realized.sourceRootPath,
      checkoutRootPath: realized.realization.targetPath,
    }),
    checkoutRootPath: realized.realization.targetPath,
    branchName: realized.realization.branchName,
  };
}

/** Restores only the exact recorded checkout; it never chooses a replacement path. */
export async function restoreRecordedWorkflowWorkspace(input: Readonly<{
  workspace: WorkflowWorkspaceProgressV1;
  verify?: (
    workspace: WorkflowWorkspaceDescriptor,
    creationIntent?: WorkflowWorkspaceCreationIntent,
  ) => Promise<'available' | 'missing' | 'conflict'>;
}>): Promise<WorkflowWorkspaceRestoreResult> {
  const descriptor = input.workspace.descriptor;
  const intent = input.workspace.creationIntent;
  if (!descriptor || !intent || !descriptor.checkout) return { ok: false, code: 'workflow_workspace_restore_unavailable' };
  const verify = input.verify ?? (async (workspace, creationIntent) => (
    await verifyWorkflowWorkspaceCurrentness(workspace, { creationIntent })
  ));
  try {
    return await verify(descriptor, intent) === 'available'
      ? { ok: true }
      : { ok: false, code: 'workflow_workspace_restore_unavailable' };
  } catch {
    return { ok: false, code: 'workflow_workspace_restore_failed' };
  }
}

export async function resolveWorkflowWorkspace(input: Readonly<{
  selection: WorkflowWorkspaceSelection;
  defaultSelection: WorkflowWorkspaceSelection;
  projectWorkspace: WorkflowWorkspaceDescriptor;
  runId: string;
  logicalInvocationRecordId: string;
  originalCommittedRevision?: string;
  /** Resolved stable workflow default when a step forks from `workflow`. */
  workflowWorkspace?: WorkflowWorkspaceDescriptor;
  conversationWorkspace?: WorkflowConversationWorkspace;
  recorded?: Readonly<{ creationIntent?: WorkflowWorkspaceCreationIntent; workspace?: WorkflowWorkspaceDescriptor }>;
  deps: Dependencies;
}>): Promise<WorkflowWorkspaceResolution> {
  if (input.recorded?.workspace) {
    const verification = await input.deps.verifyRecordedWorkspace?.(
      input.recorded.workspace,
      input.recorded.creationIntent,
    ) ?? 'available';
    if (verification !== 'available') return { ok: false, code: verification === 'missing' ? 'workspace_unavailable' : 'workspace_conflict' };
    if (input.conversationWorkspace && !sameWorkspace(input.conversationWorkspace, input.recorded.workspace)) {
      return { ok: false, code: 'conversation_workspace_mismatch' };
    }
    return { ok: true, workspace: input.recorded.workspace };
  }

  const selection = input.selection.kind === 'inherit' ? input.defaultSelection : input.selection;
  let sourceWorkspace: WorkflowWorkspaceDescriptor;
  if (selection.kind === 'inherit' || selection.kind === 'project_checkout') {
    sourceWorkspace = input.projectWorkspace;
  } else if (selection.kind === 'from_step') {
    const resolved = await input.deps.resolveProducerWorkspace?.(selection.producer);
    if (!resolved) return { ok: false, code: 'source_workspace_unavailable' };
    sourceWorkspace = resolved;
  } else {
    if (selection.source.kind === 'step') {
      const resolved = await input.deps.resolveProducerWorkspace?.(selection.source.producer);
      if (!resolved) return { ok: false, code: 'source_workspace_unavailable' };
      sourceWorkspace = resolved;
    } else {
      sourceWorkspace = input.workflowWorkspace ?? input.projectWorkspace;
    }
  }

  if (sourceWorkspace.machineId !== input.projectWorkspace.machineId) {
    return { ok: false, code: 'workspace_conflict' };
  }

  const sourceVerification = await input.deps.verifyRecordedWorkspace?.(sourceWorkspace) ?? 'available';
  if (sourceVerification !== 'available') {
    return {
      ok: false,
      code: sourceVerification === 'missing' ? 'workspace_unavailable' : 'workspace_conflict',
    };
  }

  if (input.conversationWorkspace && (
    selection.kind === 'new_worktree' || !sameWorkspace(input.conversationWorkspace, sourceWorkspace)
  )) {
    return { ok: false, code: 'conversation_workspace_mismatch' };
  }
  if (selection.kind !== 'new_worktree') {
    // Every accepted workspace choice is a row-local recovery fact, including
    // shared project and producer-derived workspaces. Persisting only newly
    // created worktrees would make a replacement coordinator re-resolve a
    // source whose current attempt or checkout may since have changed.
    await input.deps.persistWorkspace?.(sourceWorkspace);
    return { ok: true, workspace: sourceWorkspace };
  }

  const intent = input.recorded?.creationIntent ?? (() => null)();
  let creationIntent = intent;
  if (!creationIntent) {
    const baseRef = selection.source.kind === 'original'
      ? input.originalCommittedRevision ?? null
      : await (input.deps.inspectCommittedRevision ?? inspectCommittedRevision)(sourceWorkspace.checkoutRootPath);
    if (!baseRef) return { ok: false, code: 'committed_revision_unavailable' };
    creationIntent = { kind: 'git_worktree', sourceDirectory: sourceWorkspace.directory, baseRef, displayName: creationDisplayName(input.runId, input.logicalInvocationRecordId), branchMode: 'new' };
    await input.deps.persistCreationIntent?.(creationIntent);
  }
  const realized = await (input.deps.realizeWorktree ?? realizeWorktree)(creationIntent);
  if (!realized) return { ok: false, code: 'scm_unavailable' };
  const workspace: WorkflowWorkspaceDescriptor = {
    machineId: input.projectWorkspace.machineId,
    directory: realized.directory,
    checkoutRootPath: realized.checkoutRootPath,
    ...(sourceWorkspace.sourceInvocation
      ? { sourceInvocation: sourceWorkspace.sourceInvocation }
      : {}),
    checkout: { kind: 'git_worktree', branchName: realized.branchName },
  };
  await input.deps.persistWorkspace?.(workspace);
  return { ok: true, workspace };
}

export function resolveWorkflowProducerScope(
  producer: WorkflowAuthoredProducerRef,
  currentScope: WorkflowProgressEnvelopeV1['invocationPath']['scope'],
): WorkflowProgressEnvelopeV1['invocationPath']['scope'] | null {
  if (producer.scope.kind === 'current') return currentScope;
  if (producer.scope.kind === 'outer') {
    return producer.scope.levels <= currentScope.length
      ? currentScope.slice(0, currentScope.length - producer.scope.levels)
      : null;
  }
  let index = -1;
  for (let candidate = currentScope.length - 1; candidate >= 0; candidate -= 1) {
    const part = currentScope[candidate];
    if (part?.kind === 'iteration' && part.blockId === producer.scope.loopBlockId) {
      index = candidate;
      break;
    }
  }
  const part = currentScope[index];
  if (index < 0 || part?.kind !== 'iteration' || part.index === 0) return null;
  return [...currentScope.slice(0, index), { ...part, index: part.index - 1 }, ...currentScope.slice(index + 1)];
}

/** Binds the pure workspace policy adapter to the coordinator's one row-local persistence owner. */
export function createCoordinatorWorkspaceResolver(input: Readonly<{
  store: WorkflowCoordinatorStore;
  projectWorkspace: WorkflowWorkspaceDescriptor;
  originalCommittedRevision?: string;
  scm?: Pick<Dependencies, 'inspectCommittedRevision' | 'realizeWorktree' | 'verifyRecordedWorkspace'>;
}>): (params: Readonly<{
  runId: string;
  definition: WorkflowDefinitionV1;
  step: WorkflowStep;
  invocation: WorkflowCoordinatorInvocation;
  scope: WorkflowProgressEnvelopeV1['invocationPath']['scope'];
  conversationWorkspace?: WorkflowConversationWorkspace;
}>) => Promise<WorkflowWorkspaceResolution> {
  return async (params) => {
    const selection: WorkflowWorkspaceSelection = params.step.execution?.workspace ?? { kind: 'inherit' };
    const defaultSelection: WorkflowWorkspaceSelection = params.definition.defaults.workspace ?? { kind: 'project_checkout' };
    const sharesDefaultWorktree = selection.kind === 'inherit' && defaultSelection.kind === 'new_worktree';
    const rootKey = workflowInvocationKey({ runId: params.runId, blockId: '$root', scope: [], attempt: 0 });
    const rootOwner = await input.store.read(rootKey);
    const workspaceOwner = sharesDefaultWorktree
      ? rootOwner
      : params.invocation;
    if (!workspaceOwner) return { ok: false, code: 'workspace_unavailable' };

    let workflowWorkspace: WorkflowWorkspaceDescriptor | undefined;
    if (selection.kind === 'new_worktree'
      && selection.source.kind === 'workflow'
      && defaultSelection.kind === 'new_worktree') {
      if (!rootOwner) return { ok: false, code: 'workspace_unavailable' };
      const defaultResolution = await resolveWorkflowWorkspace({
        selection: defaultSelection,
        defaultSelection: { kind: 'project_checkout' },
        projectWorkspace: input.projectWorkspace,
        runId: params.runId,
        logicalInvocationRecordId: rootOwner.logicalInvocationRecordId ?? rootOwner.recordId,
        ...(input.originalCommittedRevision ? { originalCommittedRevision: input.originalCommittedRevision } : {}),
        ...(params.conversationWorkspace ? { conversationWorkspace: params.conversationWorkspace } : {}),
        ...(rootOwner.workspace ? {
          recorded: {
            ...(rootOwner.workspace.creationIntent ? { creationIntent: rootOwner.workspace.creationIntent } : {}),
            ...(rootOwner.workspace.descriptor ? { workspace: rootOwner.workspace.descriptor } : {}),
          },
        } : {}),
        deps: {
          ...(input.scm?.inspectCommittedRevision ? { inspectCommittedRevision: input.scm.inspectCommittedRevision } : {}),
          ...(input.scm?.realizeWorktree ? { realizeWorktree: input.scm.realizeWorktree } : {}),
          persistCreationIntent: async (creationIntent) => {
            await input.store.commitFact({ key: rootOwner.key, lifecycle: rootOwner.lifecycle, workspace: { creationIntent } });
          },
          persistWorkspace: async (descriptor) => {
            await input.store.commitFact({ key: rootOwner.key, lifecycle: rootOwner.lifecycle, workspace: { descriptor } });
          },
          verifyRecordedWorkspace: input.scm?.verifyRecordedWorkspace ?? (async (workspace, creationIntent) => (
            await verifyWorkflowWorkspaceCurrentness(workspace, { creationIntent })
          )),
        },
      });
      if (!defaultResolution.ok) return defaultResolution;
      workflowWorkspace = defaultResolution.workspace;
    }

    return resolveWorkflowWorkspace({
      selection,
      defaultSelection,
      projectWorkspace: input.projectWorkspace,
      ...(workflowWorkspace ? { workflowWorkspace } : {}),
      ...(params.conversationWorkspace ? { conversationWorkspace: params.conversationWorkspace } : {}),
      runId: params.runId,
      logicalInvocationRecordId: workspaceOwner.logicalInvocationRecordId ?? workspaceOwner.recordId,
      ...(input.originalCommittedRevision ? { originalCommittedRevision: input.originalCommittedRevision } : {}),
      ...(workspaceOwner.workspace ? {
        recorded: {
          ...(workspaceOwner.workspace.creationIntent ? { creationIntent: workspaceOwner.workspace.creationIntent } : {}),
          ...(workspaceOwner.workspace.descriptor ? { workspace: workspaceOwner.workspace.descriptor } : {}),
        },
      } : {}),
      deps: {
        ...(input.scm?.inspectCommittedRevision ? { inspectCommittedRevision: input.scm.inspectCommittedRevision } : {}),
        ...(input.scm?.realizeWorktree ? { realizeWorktree: input.scm.realizeWorktree } : {}),
        resolveProducerWorkspace: async (producer) => {
          const scope = resolveWorkflowProducerScope(producer, params.scope);
          if (!scope) return null;
          const record = await input.store.readCurrent?.({
            runId: params.runId, blockId: producer.blockId, scope,
          }) ?? await input.store.read(workflowInvocationKey({
            runId: params.runId, blockId: producer.blockId, scope, attempt: 0,
          }));
          return record?.workspace?.descriptor
            ? { ...record.workspace.descriptor, sourceInvocation: { producer, invocationRecordId: record.recordId } }
            : null;
        },
        persistCreationIntent: async (creationIntent) => {
          await input.store.commitFact({ key: workspaceOwner.key, lifecycle: workspaceOwner.lifecycle, workspace: { creationIntent } });
        },
        persistWorkspace: async (descriptor) => {
          await input.store.commitFact({ key: workspaceOwner.key, lifecycle: workspaceOwner.lifecycle, workspace: { descriptor } });
        },
        verifyRecordedWorkspace: input.scm?.verifyRecordedWorkspace ?? (async (workspace, creationIntent) => (
          await verifyWorkflowWorkspaceCurrentness(workspace, { creationIntent })
        )),
      },
    });
  };
}
