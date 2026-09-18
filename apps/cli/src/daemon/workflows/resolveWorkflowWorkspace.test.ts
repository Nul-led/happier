import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createInMemoryWorkflowCoordinatorStore, workflowInvocationKey } from './coordinator';
import {
  createCoordinatorWorkspaceResolver,
  prepareWorkflowAcceptedWorkspaceTarget,
  resolveWorkflowWorkspace,
  restoreRecordedWorkflowWorkspace,
  verifyWorkflowWorkspaceCurrentness,
  type WorkflowWorkspaceCreationIntent,
  type WorkflowWorkspaceDescriptor,
} from './resolveWorkflowWorkspace';
import { createGitWorkflowWorkspaceTestDependencies } from './workflowWorkspace.testkit';

describe('recorded Workflow workspace restoration', () => {
  it('accepts only the intact dirty recorded Git worktree and refuses deletion or same-path replacement', async () => {
    const fixture = await createTemporaryGitProject();
    const git = createGitWorkflowWorkspaceTestDependencies();
    try {
      let creationIntent: WorkflowWorkspaceCreationIntent | undefined;
      const created = await resolveWorkflowWorkspace({
        selection: { kind: 'new_worktree', source: { kind: 'workflow' } },
        defaultSelection: { kind: 'project_checkout' },
        projectWorkspace: {
          machineId: 'machine-1',
          directory: fixture.projectDirectory,
          checkoutRootPath: fixture.root,
        },
        runId: 'run-restore',
        logicalInvocationRecordId: 'step',
        deps: {
          ...git,
          persistCreationIntent: async (intent) => { creationIntent = intent; },
        },
      });
      if (!created.ok || !creationIntent) throw new Error('Git test fixture did not materialize a Workflow worktree');
      const workspace = { creationIntent, descriptor: created.workspace };
      await writeFile(join(created.workspace.checkoutRootPath, 'staged.txt'), 'staged\n', 'utf8');
      await execFileAsync('git', ['add', 'staged.txt'], { cwd: created.workspace.checkoutRootPath });
      await writeFile(join(created.workspace.checkoutRootPath, 'unstaged.txt'), 'unstaged\n', 'utf8');
      await writeFile(join(created.workspace.checkoutRootPath, 'untracked.txt'), 'untracked\n', 'utf8');
      const dirtyStatus = (await execFileAsync('git', ['status', '--short'], { cwd: created.workspace.checkoutRootPath })).stdout;

      await expect(restoreRecordedWorkflowWorkspace({
        workspace,
        verify: git.verifyRecordedWorkspace,
      })).resolves.toEqual({ ok: true });
      expect((await execFileAsync('git', ['status', '--short'], { cwd: created.workspace.checkoutRootPath })).stdout).toBe(dirtyStatus);

      // The agent may rename its branch while preserving the exact recorded
      // path, repository identity, and dirty contents. Recovery intentionally
      // does not require branch-name equality.
      await execFileAsync('git', ['branch', '-m', 'renamed-after-recording'], { cwd: created.workspace.checkoutRootPath });
      await expect(restoreRecordedWorkflowWorkspace({
        workspace,
        verify: git.verifyRecordedWorkspace,
      })).resolves.toEqual({ ok: true });
      expect((await execFileAsync('git', ['status', '--short'], { cwd: created.workspace.checkoutRootPath })).stdout).toBe(dirtyStatus);

      await rm(created.workspace.checkoutRootPath, { recursive: true, force: true });
      await expect(restoreRecordedWorkflowWorkspace({ workspace, verify: git.verifyRecordedWorkspace })).resolves.toEqual({
        ok: false,
        code: 'workflow_workspace_restore_unavailable',
      });

      await mkdir(created.workspace.checkoutRootPath, { recursive: true });
      await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: created.workspace.checkoutRootPath });
      await writeFile(join(created.workspace.checkoutRootPath, 'replacement.txt'), 'replacement\n', 'utf8');
      await expect(restoreRecordedWorkflowWorkspace({ workspace, verify: git.verifyRecordedWorkspace })).resolves.toEqual({
        ok: false,
        code: 'workflow_workspace_restore_unavailable',
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

const project: WorkflowWorkspaceDescriptor = {
  machineId: 'machine-1', directory: '/repo/packages/app', checkoutRootPath: '/repo', workspaceRefId: 'workspace-1',
};

const execFileAsync = promisify(execFile);

async function createTemporaryGitProject() {
  const root = await mkdtemp(join(tmpdir(), 'happier-workflow-workspace-'));
  const projectDirectory = join(root, 'packages', 'app');
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(join(root, 'README.md'), 'original\n', 'utf8');
  await writeFile(join(projectDirectory, 'index.ts'), 'export const fixture = true;\n', 'utf8');
  await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: root });
  await execFileAsync('git', ['add', 'README.md', 'packages/app/index.ts'], { cwd: root });
  await execFileAsync('git', [
    '-c', 'user.name=Workflow Test',
    '-c', 'user.email=workflow-test@example.invalid',
    'commit', '-m', 'test: seed workflow workspace',
  ], { cwd: root });
  const revision = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  await writeFile(join(root, 'README.md'), 'staged\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'unstaged-after-staged\n', 'utf8');
  await writeFile(join(root, 'untracked.txt'), 'untracked\n', 'utf8');
  const dirtyStatus = (await execFileAsync('git', ['status', '--short'], { cwd: root })).stdout;
  return { root, projectDirectory, revision, dirtyStatus };
}

describe('resolveWorkflowWorkspace', () => {
  it('freezes the canonical nested project directory and original committed revision before admission', async () => {
    const inspectLocation = vi.fn(async () => ({
      inspection: {
        rootPath: '/repo',
        committedRevision: 'a'.repeat(40),
      },
    }));
    await expect(prepareWorkflowAcceptedWorkspaceTarget({
      projectTarget: { machineId: 'machine-1', directory: '/repo/packages/app', workspaceRefId: 'workspace-1' },
      definition: {
        version: 1,
        inputs: [],
        defaults: { workspace: { kind: 'new_worktree', source: { kind: 'original' } } },
        blocks: [],
      },
      pathIsDirectory: async () => true,
      inspectLocation,
      currentServerId: 'server-1',
      resolveWorkspaceRef: () => ({
        id: 'workspace-1', serverId: 'server-1', machineId: 'machine-1', rootPath: '/repo', createdAtMs: 1,
      }),
    })).resolves.toEqual({
      ok: true,
      workspaceTarget: {
        project,
        originalCommittedRevision: 'a'.repeat(40),
      },
    });
    expect(inspectLocation).toHaveBeenCalledWith({ candidatePath: '/repo/packages/app' });
  });

  it('requires a committed revision only when the accepted workflow forks from original', async () => {
    const prepare = (definition: Parameters<typeof prepareWorkflowAcceptedWorkspaceTarget>[0]['definition']) => (
      prepareWorkflowAcceptedWorkspaceTarget({
        projectTarget: { machineId: 'machine-1', directory: '/repo/packages/app' },
        definition,
        pathIsDirectory: async () => true,
        inspectLocation: async () => ({ inspection: { rootPath: '/repo' } }),
      })
    );

    await expect(prepare({
      version: 1,
      inputs: [],
      defaults: { workspace: { kind: 'new_worktree', source: { kind: 'original' } } },
      blocks: [],
    })).resolves.toEqual({ ok: false, code: 'committed_revision_unavailable' });

    await expect(prepare({
      version: 1,
      inputs: [],
      defaults: { workspace: { kind: 'project_checkout' } },
      blocks: [],
    })).resolves.toEqual({
      ok: true,
      workspaceTarget: {
        project: {
          machineId: 'machine-1',
          directory: '/repo/packages/app',
          checkoutRootPath: '/repo',
        },
      },
    });
  });

  it('rejects a stale Account workspace identity before accepting the project target', async () => {
    const inspectLocation = vi.fn(async () => ({
      inspection: { rootPath: '/repo', committedRevision: 'a'.repeat(40) },
    }));
    const resolveWorkspaceRef = vi.fn(() => ({
      id: 'workspace-1',
      serverId: 'server-1',
      machineId: 'machine-2',
      rootPath: '/repo',
      createdAtMs: 1,
    }));

    await expect(prepareWorkflowAcceptedWorkspaceTarget({
      projectTarget: { machineId: 'machine-1', directory: '/repo/packages/app', workspaceRefId: 'workspace-1' },
      definition: { version: 1, inputs: [], defaults: {}, blocks: [] },
      currentServerId: 'server-1',
      pathIsDirectory: async () => true,
      inspectLocation,
      resolveWorkspaceRef,
    })).resolves.toEqual({ ok: false, code: 'workspace_conflict' });
    expect(resolveWorkspaceRef).toHaveBeenCalledWith('workspace-1');
  });

  it('rejects an Account workspace identity whose canonical root differs from the inspected checkout', async () => {
    await expect(prepareWorkflowAcceptedWorkspaceTarget({
      projectTarget: { machineId: 'machine-1', directory: '/repo/packages/app', workspaceRefId: 'workspace-1' },
      definition: { version: 1, inputs: [], defaults: {}, blocks: [] },
      currentServerId: 'server-1',
      pathIsDirectory: async () => true,
      inspectLocation: async () => ({ inspection: { rootPath: '/repo' } }),
      resolveWorkspaceRef: () => ({
        id: 'workspace-1', serverId: 'server-1', machineId: 'machine-1',
        rootPath: '/other-repo', createdAtMs: 1,
      }),
    })).resolves.toEqual({ ok: false, code: 'workspace_conflict' });
  });

  it.each([
    {
      name: 'Windows drive and mixed separators',
      platform: 'win32' as const,
      env: { USERPROFILE: 'C:\\Users\\alice' },
      directory: '~\\repo/packages\\app',
      rootPath: 'C:\\Users\\alice\\repo',
      expectedDirectory: 'C:\\Users\\alice\\repo\\packages\\app',
    },
    {
      name: 'Windows UNC path',
      platform: 'win32' as const,
      env: {},
      directory: '\\\\server\\share\\repo\\packages\\app',
      rootPath: '\\\\server\\share\\repo',
      expectedDirectory: '\\\\server\\share\\repo\\packages\\app',
    },
    {
      name: 'POSIX home-relative nested path',
      platform: 'darwin' as const,
      env: { HOME: '/Users/alice' },
      directory: '~/repo/packages/app',
      rootPath: '/Users/alice/repo',
      expectedDirectory: '/Users/alice/repo/packages/app',
    },
  ])('uses canonical target path handling for $name', async ({ platform, env, directory, rootPath, expectedDirectory }) => {
    await expect(prepareWorkflowAcceptedWorkspaceTarget({
      projectTarget: { machineId: 'machine-1', directory },
      definition: { version: 1, inputs: [], defaults: {}, blocks: [] },
      env,
      platform,
      pathIsDirectory: async (path) => path === expectedDirectory,
      inspectLocation: async ({ candidatePath }) => ({ inspection: { rootPath: candidatePath === expectedDirectory ? rootPath : '/wrong' } }),
    })).resolves.toEqual({
      ok: true,
      workspaceTarget: { project: { machineId: 'machine-1', directory: expectedDirectory, checkoutRootPath: rootPath } },
    });
  });

  it('does not treat a sibling-prefixed Windows home as the selected home', async () => {
    await expect(prepareWorkflowAcceptedWorkspaceTarget({
      projectTarget: { machineId: 'machine-1', directory: 'C:\\Users\\alice2\\repo' },
      definition: { version: 1, inputs: [], defaults: {}, blocks: [] },
      env: { USERPROFILE: 'C:\\Users\\alice' },
      platform: 'win32',
      pathIsDirectory: async (path) => path === 'C:\\Users\\alice2\\repo',
      inspectLocation: async () => ({ inspection: { rootPath: 'C:\\Users\\alice2\\repo' } }),
    })).resolves.toEqual({
      ok: true,
      workspaceTarget: { project: { machineId: 'machine-1', directory: 'C:\\Users\\alice2\\repo', checkoutRootPath: 'C:\\Users\\alice2\\repo' } },
    });
  });

  it('resolves inherit to the stable workflow default and from-step to the exact scoped invocation', async () => {
    const prior = { machineId: 'machine-1', directory: '/repo/.dev/worktree/a', checkoutRootPath: '/repo/.dev/worktree/a' };
    const resolveProducerWorkspace = vi.fn(async () => prior);
    const deps = { resolveProducerWorkspace };

    await expect(resolveWorkflowWorkspace({ selection: { kind: 'inherit' }, defaultSelection: { kind: 'project_checkout' }, projectWorkspace: project, runId: 'run-1', logicalInvocationRecordId: 'inv-b', deps })).resolves.toEqual({ ok: true, workspace: project });
    await expect(resolveWorkflowWorkspace({ selection: { kind: 'from_step', producer: { blockId: 'a', scope: { kind: 'current' } } }, defaultSelection: { kind: 'project_checkout' }, projectWorkspace: project, runId: 'run-1', logicalInvocationRecordId: 'inv-b', deps })).resolves.toEqual({ ok: true, workspace: prior });
    expect(resolveProducerWorkspace).toHaveBeenCalledWith({ blockId: 'a', scope: { kind: 'current' } });
  });

  it('persists one revision-pinned creation intent before SCM materialization and rejoins it on retry', async () => {
    const persistCreationIntent = vi.fn(async (_intent: WorkflowWorkspaceCreationIntent) => undefined);
    const persistWorkspace = vi.fn(async () => undefined);
    const realizeWorktree = vi.fn(async () => ({ directory: '/repo/.dev/worktree/workflow-run-1-inv-a/packages/app', checkoutRootPath: '/repo/.dev/worktree/workflow-run-1-inv-a', branchName: 'workflow-run-1-inv-a' }));
    const deps = {
      inspectCommittedRevision: vi.fn(async () => 'a'.repeat(40)),
      realizeWorktree,
      persistCreationIntent,
      persistWorkspace,
    };
    const base = { selection: { kind: 'new_worktree', source: { kind: 'workflow' } } as const, defaultSelection: { kind: 'project_checkout' } as const, projectWorkspace: project, runId: 'run-1', logicalInvocationRecordId: 'inv-a', deps };

    const first = await resolveWorkflowWorkspace(base);
    expect(first.ok).toBe(true);
    expect(persistCreationIntent).toHaveBeenCalledBefore(realizeWorktree);
    expect(realizeWorktree).toHaveBeenCalledWith(expect.objectContaining({ baseRef: 'a'.repeat(40), displayName: 'workflow-run-1-inv-a' }));

    const recordedIntent = persistCreationIntent.mock.calls[0]![0];
    await resolveWorkflowWorkspace({ ...base, recorded: { creationIntent: recordedIntent } });
    expect(deps.inspectCommittedRevision).toHaveBeenCalledTimes(1);
    expect(realizeWorktree).toHaveBeenLastCalledWith(recordedIntent);
  });

  it('returns typed preflight and unavailable outcomes before filesystem effects', async () => {
    const realizeWorktree = vi.fn();
    await expect(resolveWorkflowWorkspace({
      selection: { kind: 'new_worktree', source: { kind: 'original' } }, defaultSelection: { kind: 'project_checkout' }, projectWorkspace: project,
      conversationWorkspace: { machineId: project.machineId, directory: '/other' }, runId: 'run-1', logicalInvocationRecordId: 'inv-a',
      deps: { realizeWorktree },
    })).resolves.toEqual({ ok: false, code: 'conversation_workspace_mismatch' });
    expect(realizeWorktree).not.toHaveBeenCalled();

    await expect(resolveWorkflowWorkspace({
      selection: { kind: 'inherit' }, defaultSelection: { kind: 'project_checkout' }, projectWorkspace: project, runId: 'run-1', logicalInvocationRecordId: 'inv-a',
      recorded: { workspace: project }, deps: { verifyRecordedWorkspace: async () => 'missing' },
    })).resolves.toEqual({ ok: false, code: 'workspace_unavailable' });

    const producer = { ...project, directory: '/worktrees/producer/packages/app', checkoutRootPath: '/worktrees/producer' };
    await expect(resolveWorkflowWorkspace({
      selection: { kind: 'from_step', producer: { blockId: 'a', scope: { kind: 'current' } } },
      defaultSelection: { kind: 'project_checkout' }, projectWorkspace: project,
      runId: 'run-1', logicalInvocationRecordId: 'inv-a',
      deps: {
        resolveProducerWorkspace: async () => producer,
        verifyRecordedWorkspace: async (workspace) => workspace === producer ? 'conflict' : 'available',
      },
    })).resolves.toEqual({ ok: false, code: 'workspace_conflict' });

    await expect(resolveWorkflowWorkspace({
      selection: { kind: 'inherit' }, defaultSelection: { kind: 'project_checkout' }, projectWorkspace: project,
      runId: 'run-1', logicalInvocationRecordId: 'inv-a',
      deps: { verifyRecordedWorkspace: async () => 'missing' },
    })).resolves.toEqual({ ok: false, code: 'workspace_unavailable' });

    await expect(resolveWorkflowWorkspace({
      selection: { kind: 'inherit' }, defaultSelection: { kind: 'project_checkout' }, projectWorkspace: project,
      conversationWorkspace: { machineId: project.machineId, directory: '/other' }, runId: 'run-1', logicalInvocationRecordId: 'inv-a',
      recorded: { workspace: project }, deps: { verifyRecordedWorkspace: async () => 'available' },
    })).resolves.toEqual({ ok: false, code: 'conversation_workspace_mismatch' });
  });

  it('checks an accepted project against the current canonical SCM root before first use', async () => {
    await expect(verifyWorkflowWorkspaceCurrentness(project, {
      pathIsDirectory: async () => true,
      inspectLocation: async () => ({ inspection: { rootPath: '/different-checkout' } }),
    })).resolves.toBe('conflict');

    const ordinaryDirectory = { machineId: 'machine-1', directory: '/plain', checkoutRootPath: '/plain' };
    await expect(verifyWorkflowWorkspaceCurrentness(ordinaryDirectory, {
      pathIsDirectory: async () => true,
      inspectLocation: async () => null,
    })).resolves.toBe('available');
  });

  it('binds exact producer scope and row-local creation progress through the coordinator store', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const sourceKey = workflowInvocationKey({ runId: 'run-1', blockId: 'a', scope: [], attempt: 0 });
    await store.ensureIntent({ key: sourceKey, recordId: 'inv-a', runId: 'run-1', blockId: 'a', path: { blockId: 'a', scope: [] }, attempt: 0, acceptedAtMs: 1, lifecycle: 'completed', workspace: { descriptor: project } });
    const targetKey = workflowInvocationKey({ runId: 'run-1', blockId: 'b', scope: [], attempt: 0 });
    const target = await store.ensureIntent({ key: targetKey, recordId: 'inv-b', runId: 'run-1', blockId: 'b', path: { blockId: 'b', scope: [] }, attempt: 0, acceptedAtMs: 2, lifecycle: 'admitting' });
    const resolver = createCoordinatorWorkspaceResolver({
      store,
      projectWorkspace: project,
      scm: { verifyRecordedWorkspace: async () => 'available' },
    });
    const result = await resolver({
      runId: 'run-1',
      definition: { version: 1, inputs: [], defaults: {}, blocks: [] },
      step: { kind: 'step', id: 'b', document: { text: 'b', references: [], attachments: [] }, input: [], result: { kind: 'text' }, execution: { workspace: { kind: 'from_step', producer: { blockId: 'a', scope: { kind: 'current' } } } } },
      invocation: target,
      scope: [],
    });
    expect(result).toEqual({ ok: true, workspace: { ...project, sourceInvocation: { producer: { blockId: 'a', scope: { kind: 'current' } }, invocationRecordId: 'inv-a' } } });
    expect(store.records.get(targetKey)?.workspace?.descriptor).toEqual(result.ok ? result.workspace : undefined);
  });

  it('uses the latest producer attempt instead of reopening attempt zero', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const oldWorkspace = { ...project, directory: '/repo-old', checkoutRootPath: '/repo-old' };
    for (const [attempt, descriptor] of [[0, oldWorkspace], [1, project]] as const) {
      const key = workflowInvocationKey({ runId: 'run-1', blockId: 'a', scope: [], attempt });
      await store.ensureIntent({ key, recordId: `inv-a-${attempt}`, runId: 'run-1', blockId: 'a', path: { blockId: 'a', scope: [] }, attempt, acceptedAtMs: attempt, lifecycle: 'completed', workspace: { descriptor } });
    }
    const targetKey = workflowInvocationKey({ runId: 'run-1', blockId: 'b', scope: [], attempt: 0 });
    const target = await store.ensureIntent({ key: targetKey, recordId: 'inv-b', runId: 'run-1', blockId: 'b', path: { blockId: 'b', scope: [] }, attempt: 0, acceptedAtMs: 2, lifecycle: 'admitting' });
    const resolver = createCoordinatorWorkspaceResolver({
      store,
      projectWorkspace: project,
      scm: { verifyRecordedWorkspace: async () => 'available' },
    });
    const result = await resolver({
      runId: 'run-1',
      definition: { version: 1, inputs: [], defaults: {}, blocks: [] },
      step: { kind: 'step', id: 'b', document: { text: 'b', references: [], attachments: [] }, input: [], result: { kind: 'text' }, execution: { workspace: { kind: 'from_step', producer: { blockId: 'a', scope: { kind: 'current' } } } } },
      invocation: target,
      scope: [],
    });
    expect(result).toEqual({ ok: true, workspace: { ...project, sourceInvocation: { producer: { blockId: 'a', scope: { kind: 'current' } }, invocationRecordId: 'inv-a-1' } } });
  });

  it('materializes one workflow-default worktree correspondence shared by inheriting steps', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const rootKey = workflowInvocationKey({ runId: 'run-1', blockId: '$root', scope: [], attempt: 0 });
    await store.ensureIntent({ key: rootKey, recordId: 'root-1', runId: 'run-1', blockId: '$root', path: { blockId: '$root', scope: [] }, attempt: 0, acceptedAtMs: 0, lifecycle: 'running' });
    const realizeWorktree = vi.fn(async () => ({ directory: '/worktrees/shared/packages/app', checkoutRootPath: '/worktrees/shared', branchName: 'shared' }));
    const resolver = createCoordinatorWorkspaceResolver({
      store,
      projectWorkspace: project,
      originalCommittedRevision: 'a'.repeat(40),
      scm: { realizeWorktree, verifyRecordedWorkspace: async () => 'available' },
    });
    const definition = { version: 1 as const, inputs: [], defaults: { workspace: { kind: 'new_worktree' as const, source: { kind: 'original' as const } } }, blocks: [] };
    const resolveStep = async (id: string) => {
      const key = workflowInvocationKey({ runId: 'run-1', blockId: id, scope: [], attempt: 0 });
      const invocation = await store.ensureIntent({ key, recordId: `inv-${id}`, runId: 'run-1', blockId: id, path: { blockId: id, scope: [] }, attempt: 0, acceptedAtMs: 1, lifecycle: 'admitting' });
      return await resolver({
        runId: 'run-1', definition,
        step: { kind: 'step', id, document: { text: id, references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        invocation, scope: [],
      });
    };
    const first = await resolveStep('a');
    const second = await resolveStep('b');
    expect(first).toEqual(second);
    expect(realizeWorktree).toHaveBeenCalledTimes(1);
    expect(store.records.get(rootKey)?.workspace?.descriptor).toEqual(first.ok ? first.workspace : undefined);
  });

  it('materializes an explicit workflow-sourced worktree from the current shared default checkout', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const rootKey = workflowInvocationKey({ runId: 'run-1', blockId: '$root', scope: [], attempt: 0 });
    await store.ensureIntent({ key: rootKey, recordId: 'root-1', runId: 'run-1', blockId: '$root', path: { blockId: '$root', scope: [] }, attempt: 0, acceptedAtMs: 0, lifecycle: 'running' });
    const targetKey = workflowInvocationKey({ runId: 'run-1', blockId: 'child', scope: [], attempt: 0 });
    const target = await store.ensureIntent({ key: targetKey, recordId: 'inv-child', runId: 'run-1', blockId: 'child', path: { blockId: 'child', scope: [] }, attempt: 0, acceptedAtMs: 1, lifecycle: 'admitting' });
    const realizeWorktree = vi.fn(async (intent) => intent.displayName === 'workflow-run-1-root-1'
      ? { directory: '/worktrees/default/packages/app', checkoutRootPath: '/worktrees/default', branchName: 'default' }
      : { directory: '/worktrees/child/packages/app', checkoutRootPath: '/worktrees/child', branchName: 'child' });
    const inspectCommittedRevision = vi.fn(async (directory: string) => directory === '/worktrees/default'
      ? 'b'.repeat(40)
      : null);
    const resolver = createCoordinatorWorkspaceResolver({
      store,
      projectWorkspace: project,
      originalCommittedRevision: 'a'.repeat(40),
      scm: { inspectCommittedRevision, realizeWorktree, verifyRecordedWorkspace: async () => 'available' },
    });
    const definition = { version: 1 as const, inputs: [], defaults: { workspace: { kind: 'new_worktree' as const, source: { kind: 'original' as const } } }, blocks: [] };
    const result = await resolver({
      runId: 'run-1', definition,
      step: { kind: 'step', id: 'child', document: { text: 'child', references: [], attachments: [] }, input: [], result: { kind: 'text' }, execution: { workspace: { kind: 'new_worktree', source: { kind: 'workflow' } } } },
      invocation: target, scope: [],
    });

    expect(result).toEqual({ ok: true, workspace: { machineId: 'machine-1', directory: '/worktrees/child/packages/app', checkoutRootPath: '/worktrees/child', checkout: { kind: 'git_worktree', branchName: 'child' } } });
    expect(inspectCommittedRevision).toHaveBeenCalledWith('/worktrees/default');
    expect(realizeWorktree).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceDirectory: '/worktrees/default/packages/app', baseRef: 'b'.repeat(40), displayName: 'workflow-run-1-inv-child',
    }));
  });

  it('preserves the exact source invocation when a new worktree forks from a repeated producer', async () => {
    const sourceInvocation = {
      producer: {
        blockId: 'analyze',
        scope: { kind: 'previous_iteration' as const, loopBlockId: 'items' },
      },
      invocationRecordId: 'inv-analyze-iteration-7',
    };
    const result = await resolveWorkflowWorkspace({
      selection: { kind: 'new_worktree', source: { kind: 'step', producer: sourceInvocation.producer } },
      defaultSelection: { kind: 'project_checkout' },
      projectWorkspace: project,
      runId: 'run-1',
      logicalInvocationRecordId: 'inv-child',
      deps: {
        resolveProducerWorkspace: async () => ({ ...project, sourceInvocation }),
        verifyRecordedWorkspace: async () => 'available',
        inspectCommittedRevision: async () => 'a'.repeat(40),
        realizeWorktree: async () => ({
          directory: '/worktrees/child', checkoutRootPath: '/worktrees/child', branchName: 'child',
        }),
      },
    });

    expect(result).toEqual({
      ok: true,
      workspace: {
        machineId: 'machine-1',
        directory: '/worktrees/child',
        checkoutRootPath: '/worktrees/child',
        sourceInvocation,
        checkout: { kind: 'git_worktree', branchName: 'child' },
      },
    });
  });

  it('rejoins one invocation-qualified shared worktree when sibling first-use calls overlap', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const rootKey = workflowInvocationKey({ runId: 'run-1', blockId: '$root', scope: [], attempt: 0 });
    await store.ensureIntent({ key: rootKey, recordId: 'root-1', runId: 'run-1', blockId: '$root', path: { blockId: '$root', scope: [] }, attempt: 0, acceptedAtMs: 0, lifecycle: 'running' });
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const realizeWorktree = vi.fn(async (_intent: WorkflowWorkspaceCreationIntent) => {
      if (realizeWorktree.mock.calls.length === 1) {
        releaseFirst();
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      } else {
        await firstStarted;
      }
      return { directory: '/worktrees/shared/packages/app', checkoutRootPath: '/worktrees/shared', branchName: 'workflow-run-1-root-1' };
    });
    const resolver = createCoordinatorWorkspaceResolver({
      store,
      projectWorkspace: project,
      originalCommittedRevision: 'a'.repeat(40),
      scm: { realizeWorktree, verifyRecordedWorkspace: async () => 'available' },
    });
    const definition = { version: 1 as const, inputs: [], defaults: { workspace: { kind: 'new_worktree' as const, source: { kind: 'original' as const } } }, blocks: [] };
    const invocation = async (id: string) => {
      const key = workflowInvocationKey({ runId: 'run-1', blockId: id, scope: [], attempt: 0 });
      return await store.ensureIntent({ key, recordId: `inv-${id}`, runId: 'run-1', blockId: id, path: { blockId: id, scope: [] }, attempt: 0, acceptedAtMs: 1, lifecycle: 'admitting' });
    };
    const [a, b] = await Promise.all([invocation('a'), invocation('b')]);
    const step = (id: string) => ({ kind: 'step' as const, id, document: { text: id, references: [], attachments: [] }, input: [], result: { kind: 'text' as const } });
    const [first, second] = await Promise.all([
      resolver({ runId: 'run-1', definition, step: step('a'), invocation: a, scope: [] }),
      resolver({ runId: 'run-1', definition, step: step('b'), invocation: b, scope: [] }),
    ]);

    expect(first).toEqual(second);
    expect(realizeWorktree.mock.calls.every(([intent]) => intent.displayName === 'workflow-run-1-root-1')).toBe(true);
    expect(store.records.get(rootKey)?.workspace?.descriptor).toEqual(first.ok ? first.workspace : undefined);
  });

  it('keeps project-checkout work shared and materializes an isolated revision-pinned Git worktree through the canonical SCM owner', async () => {
    const fixture = await createTemporaryGitProject();
    const git = createGitWorkflowWorkspaceTestDependencies();
    try {
      const projectWorkspace: WorkflowWorkspaceDescriptor = {
        machineId: 'machine-1',
        directory: fixture.projectDirectory,
        checkoutRootPath: fixture.root,
      };

      const shared = await resolveWorkflowWorkspace({
        selection: { kind: 'project_checkout' },
        defaultSelection: { kind: 'project_checkout' },
        projectWorkspace,
        runId: 'run-real-git',
        logicalInvocationRecordId: 'shared',
        deps: {},
      });
      expect(shared).toEqual({ ok: true, workspace: projectWorkspace });

      const creationIntents: unknown[] = [];
      const created = await resolveWorkflowWorkspace({
        selection: { kind: 'new_worktree', source: { kind: 'workflow' } },
        defaultSelection: { kind: 'project_checkout' },
        projectWorkspace,
        runId: 'run-real-git',
        logicalInvocationRecordId: 'isolated',
        deps: {
          ...git,
          persistCreationIntent: async (intent) => { creationIntents.push(intent); },
        },
      });

      expect(created).toMatchObject({
        ok: true,
        workspace: {
          machineId: 'machine-1',
          checkout: { kind: 'git_worktree', branchName: 'workflow-run-real-git-isolated' },
        },
      });
      if (!created.ok) throw new Error(created.code);
      expect(created.workspace.checkoutRootPath).not.toBe(fixture.root);
      expect(created.workspace.directory).toBe(join(created.workspace.checkoutRootPath, 'packages', 'app'));
      expect(await readFile(join(created.workspace.checkoutRootPath, 'README.md'), 'utf8')).toBe('original\n');
      await expect(readFile(join(created.workspace.checkoutRootPath, 'untracked.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: created.workspace.checkoutRootPath })).stdout.trim())
        .toBe(fixture.revision);
      expect(await readFile(join(fixture.root, 'README.md'), 'utf8')).toBe('unstaged-after-staged\n');
      expect(await readFile(join(fixture.root, 'untracked.txt'), 'utf8')).toBe('untracked\n');
      const currentStatus = (await execFileAsync('git', ['status', '--short'], { cwd: fixture.root })).stdout;
      for (const originalEntry of fixture.dirtyStatus.trim().split('\n')) {
        expect(currentStatus).toContain(originalEntry);
      }
      expect(creationIntents).toEqual([{
        kind: 'git_worktree',
        sourceDirectory: fixture.projectDirectory,
        baseRef: fixture.revision,
        displayName: 'workflow-run-real-git-isolated',
        branchMode: 'new',
      }]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
