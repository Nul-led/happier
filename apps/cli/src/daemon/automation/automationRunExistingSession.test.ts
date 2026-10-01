import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManagedSessionDirectories } from '@/session/creation/managedSessionDirectories';
import { ensureSessionDirectory } from '@/daemon/startup/ensureSessionDirectory';
import { resolvePreparedSessionDirectory } from '@/daemon/startup/resolvePreparedSessionDirectory';
import { runAutomationAgainstExistingSession } from './automationRunExistingSession';

// Machine configuration and file logging are environmental boundaries; directory
// classification, ownership, consent and filesystem effects stay real.
vi.mock('@/configuration', () => ({ configuration: { activeServerDir: '/unused' } }));
vi.mock('@/ui/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('existing-session automation directory consent', () => {
  it('does not recreate a missing managed folder even when a saved template claims ordinary-path consent', async () => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-automation-managed-'));
    roots.push(activeServerDir);
    const owner = createManagedSessionDirectories({ activeServerDir });
    const allocation = await owner.materializeForFreshSpawn({ sessionCreationTag: 'automation' });
    await owner.bind({ allocationId: allocation.allocationId, sessionId: 'session' });
    await rm(allocation.directory, { recursive: true });
    const result = await runAutomationAgainstExistingSession({
      template: { directory: allocation.directory, directoryKind: 'path', existingSessionId: 'session', approvedNewDirectoryCreation: true },
      spawnSession: async (options) => {
        const prepared = resolvePreparedSessionDirectory({ options, normalizedExistingSessionId: 'session',
          existingSessionWorkspacePath: allocation.directory,
          ownerMetadata: { v: 1, workspace: { path: allocation.directory, sessionDirectoryV1: { v: 1, kind: 'managed' } } } });
        expect(prepared.directoryKind).toBe('managed');
        const resolved = await owner.prepareForSpawn({ ...options, directory: prepared.directory });
        return resolved.ok ? { type: 'success', sessionId: 'session' } : { type: 'error', errorCode: resolved.errorCode, errorMessage: 'missing' };
      },
    });
    expect(result).toMatchObject({ type: 'error', errorCode: 'SESSION_DIRECTORY_MISSING' });
    await expect(access(allocation.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains ordinary path automation creation through the path owner default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-automation-path-'));
    roots.push(root);
    const directory = join(root, 'missing');
    const result = await runAutomationAgainstExistingSession({
      template: { directory, existingSessionId: 'session', approvedNewDirectoryCreation: false },
      spawnSession: async (options) => {
        const ensured = await ensureSessionDirectory({ directory: options.directory,
          approvedNewDirectoryCreation: options.approvedNewDirectoryCreation ?? true });
        return ensured.ok ? { type: 'success', sessionId: 'session' } : ensured.response;
      },
    });
    expect(result).toMatchObject({ type: 'success', sessionId: 'session' });
    await expect(access(directory)).resolves.toBeUndefined();
  });
});
