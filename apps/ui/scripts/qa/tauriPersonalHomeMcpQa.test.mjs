import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    buildTauriPersonalHomeQaPlan,
    inspectPersonalHomeRuntimeEvidence,
} from './tauriPersonalHomeMcpQa.mjs';

test('personal-home loaded QA plan uses the production shell and settings projections as observable proof', () => {
    const plan = buildTauriPersonalHomeQaPlan({
        env: {
            HAPPIER_STACK_STACK: 'lane03-personal-home-qa',
            HAPPIER_STACK_TAURI_IDENTIFIER: 'com.happier.stack.lane03-personal-home-qa',
        },
    });

    assert.equal(plan.appIdentifier, 'com.happier.stack.lane03-personal-home-qa');
    assert.deepEqual(plan.shellSelectors, [
        '[data-testid="desktop-sidebar-chrome"]',
        '[data-testid="desktop-collapsed-shell-chrome"]',
        '[data-testid="desktop-narrow-shell-chrome"]',
    ]);
    assert.equal(plan.personalHomeSettingsSelector, '[data-testid="settings.personalHomeRuntime.identity"]');
    assert.equal(plan.forbiddenOnboardingSelector, '[data-testid="onboarding-wizard-welcome-auth"]');
});

test('runtime evidence inspection proves the persisted purpose, closure, listener receipt, and live health without exposing credentials', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'tauri-personal-home-evidence-'));
    const installRoot = join(homeDir, '.happier', 'self-host');
    const configDir = join(installRoot, 'config');
    const dataDir = join(installRoot, 'data');
    await mkdir(configDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(installRoot, 'self-host-state.json'), JSON.stringify({
        version: '0.3.0-test',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
    }));
    await writeFile(join(configDir, 'server.env'), [
        'HAPPIER_SERVER_HOST=127.0.0.1',
        'PORT=43123',
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
        'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    ].join('\n'));
    await writeFile(join(dataDir, 'startup-receipt.json'), JSON.stringify({
        pid: 123,
        nonce: 'fixture',
        host: '127.0.0.1',
        port: 43123,
    }));

    const evidence = await inspectPersonalHomeRuntimeEvidence({
        env: { HOME: homeDir },
        fetchImpl: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    });

    assert.deepEqual(evidence, {
        anonymousSignupEnabled: false,
        canonicalServerUrl: 'http://127.0.0.1:43123',
        defaultAccountMode: 'plain',
        healthy: true,
        listener: { host: '127.0.0.1', port: 43123 },
        purpose: 'personal-home',
        storagePolicy: 'plaintext_only',
        version: '0.3.0-test',
    });
    assert.equal(JSON.stringify(evidence).includes('token'), false);
    assert.equal(JSON.stringify(evidence).includes('secret'), false);
});
