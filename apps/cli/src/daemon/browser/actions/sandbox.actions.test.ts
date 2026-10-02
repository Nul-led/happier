import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonRuntimeActionExecutor } from '../../runtimeActionExecutor';

// The installed daemon identity is persisted OS state; admission and family dispatch stay real.
vi.mock('@/persistence', () => ({ readSettings: async () => ({ machineId: 'machine' }) }));
const environment = vi.hoisted(() => ({ happyHomeDir: '', cancel: undefined as AbortController | undefined }));
vi.mock('@/configuration', async importOriginal => {
  const original = await importOriginal<typeof import('@/configuration')>();
  // Configuration is the environment boundary; retain its real defaults and methods.
  const configuration: typeof original.configuration = Object.create(original.configuration);
  Object.defineProperty(configuration, 'happyHomeDir', { get: () => environment.happyHomeDir });
  return { ...original, configuration };
});
// The archive download is the network boundary; real acquisition/verification owners remain in use.
vi.mock('@happier-dev/cli-common/agents', async importOriginal => ({
  ...await importOriginal<typeof import('@happier-dev/cli-common/agents')>(),
  downloadGitHubReleaseAsset: async (params: { signal?: AbortSignal }) => {
    if (!params.signal) throw new Error('Acquisition did not receive Action cancellation');
    environment.cancel?.abort();
    params.signal.throwIfAborted();
  },
}));
const originalPlatform = process.platform;
const originalArch = process.arch;
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  Object.defineProperty(process, 'arch', { value: originalArch });
});

it('admits approved sandbox recovery without a browser route, but refuses unapproved and wrong-machine requests', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  const execute = createDaemonRuntimeActionExecutor({ env: {}, resolveRouteOwners: () => ({}),
    resolveServerFeaturesSnapshot: () => undefined });
  const args = { actionId: 'browser.sandbox.install' as const, input: { machineId: 'machine' },
    context: { authority: 'account_automation' as const } };
  expect(await execute(args)).toMatchObject({ ok: false, errorCode: 'approval_required' });
  expect(await execute({ ...args, context: { ...args.context, bypassApprovals: true } }))
    .toEqual({ status: 'failed', code: 'platform_unsupported' });
  expect(await execute({ ...args, input: { machineId: 'other' }, context: { ...args.context, bypassApprovals: true } }))
    .toMatchObject({ ok: false, errorCode: 'browser_machine_mismatch' });
});

it('cancels managed artifact acquisition through the existing archive owner and returns a typed cancellation', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  Object.defineProperty(process, 'arch', { value: 'x64' });
  environment.happyHomeDir = await mkdtemp(join(tmpdir(), 'sandbox-action-test-'));
  environment.cancel = new AbortController();
  try {
    const execute = createDaemonRuntimeActionExecutor({ env: {}, resolveRouteOwners: () => ({}),
      resolveServerFeaturesSnapshot: () => undefined });
    expect(await execute({ actionId: 'browser.sandbox.install', input: { machineId: 'machine' },
      context: { authority: 'account_automation', bypassApprovals: true, signal: environment.cancel.signal } }))
      .toEqual({ status: 'failed', code: 'cancelled' });
  } finally { await rm(environment.happyHomeDir, { recursive: true, force: true }); }
});
