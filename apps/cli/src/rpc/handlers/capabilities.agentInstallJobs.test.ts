import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test, vi } from 'vitest';

const root = await mkdtemp(join(tmpdir(), 'agent-capability-preview-'));
vi.stubEnv('HOME', root);
vi.stubEnv('HAPPIER_HOME_DIR', root);
vi.stubEnv('PATH', join(root, 'empty-path'));
vi.stubEnv('HAPPIER_CLAUDE_PATH', '');
// Load the real owner during collection; module loading is not the behavior under test.
const { createCliCapabilitiesService } = await import('./capabilities');

afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

test('agent capability install retains read-only preview, never a second software mutation path', async () => {
    const service = await createCliCapabilitiesService();
    const cli = service.describe().capabilities.find((entry) => entry.id === 'cli.claude');
    expect(cli).toBeDefined();
    // The still-live installability reader uses this method only for a dry-run preview.
    expect(cli?.methods?.install).toBeDefined();
    await expect(service.invoke({ id: 'cli.claude', method: 'install', params: { intent: 'update' } }))
        .resolves.toMatchObject({ ok: false, error: { code: 'unsupported-method' } });
    await expect(service.invoke({ id: 'cli.claude', method: 'install', params: { dryRun: true } }))
        .resolves.toMatchObject({ ok: true });
});
