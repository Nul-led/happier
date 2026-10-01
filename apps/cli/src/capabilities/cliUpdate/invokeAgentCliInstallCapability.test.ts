import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test, vi } from 'vitest';

const root = await mkdtemp(join(tmpdir(), 'agent-install-preview-'));
vi.stubEnv('HOME', root);
vi.stubEnv('HAPPIER_HOME_DIR', root);
vi.stubEnv('PATH', join(root, 'empty-path'));
vi.stubEnv('HAPPIER_CLAUDE_PATH', '');
const { invokeAgentCliInstallCapability } = await import('./invokeAgentCliInstallCapability');

afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

test('capability refuses mutations even with vendor consent or update intent', async () => {
    for (const params of [undefined, { allowVendorRecipeExecution: true }, { intent: 'update' }]) {
        await expect(invokeAgentCliInstallCapability('claude', params))
            .resolves.toMatchObject({ ok: false, error: { code: 'unsupported-method' } });
    }
});

test('capability keeps the live installability reader read-only', async () => {
    await expect(invokeAgentCliInstallCapability('claude', { dryRun: true }))
        .resolves.toMatchObject({ ok: true, result: { plan: { installMode: 'vendor_recipe' } } });
});
