import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function writePersonalHomeIdentity(databasePath, homeServerIdentityId) {
    const database = new DatabaseSync(databasePath);
    try {
        database.exec('CREATE TABLE IF NOT EXISTS SimpleCache (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        database.prepare('INSERT OR REPLACE INTO SimpleCache (key, value) VALUES (?, ?)')
            .run('server.identity.v1', homeServerIdentityId);
    } finally {
        database.close();
    }
}

import {
    buildTauriPersonalHomeQaPlan,
    inspectPersonalHomePreservationEvidence,
    inspectPersonalHomeRuntimeEvidence,
    verifyPersonalHomeAppRelaunch,
    verifyAnonymousSignupRefused,
    verifyPersonalHomeDestructiveArbitrationRecovery,
    verifyPersonalHomeBackupRestoreRestart,
    verifyPersonalHomeSessionEvidence,
    waitForRestartedPersonalHomeEvidence,
} from './tauriPersonalHomeMcpQa.mjs';

test('backup restore journey uses canonical CLI operations before restart and proves retained Home facts', async () => {
    const calls = [];
    const backupPath = join(tmpdir(), 'external-personal-home-backup.tar');
    const homeServerIdentityId = 'home-identity-backup-restore';
    const canonicalServerUrl = 'http://127.0.0.1:43123';
    const manifest = {
        format: 'happier-personal-home-backup',
        version: 1,
        homeServerIdentityId,
    };
    const evidence = await verifyPersonalHomeBackupRestoreRestart({
        backupPath,
        canonicalServerUrl,
        homeServerIdentityId,
        preservationBeforeRestore: {
            configSha256: 'config-sha256',
            masterSecretSha256: 'master-secret-sha256',
            purpose: 'personal-home',
        },
        runCliJson: async (args) => {
            calls.push(args.join(' '));
            if (args[1] === 'backup') {
                return {
                    kind: 'personal_home_task_result',
                    result: { ok: true, data: { path: backupPath, sha256: 'a'.repeat(64), manifest } },
                };
            }
            if (args[1] === 'verify-backup') {
                return {
                    kind: 'personal_home_task_result',
                    result: { ok: true, data: { identityMatchesCurrentHome: 'match', manifest } },
                };
            }
            return {
                kind: 'personal_home_task_result',
                result: { ok: true, data: { outcome: 'restored', manifest } },
            };
        },
        restartLoadedAppAndRuntime: async () => {
            calls.push('restart-loaded-app-and-runtime');
            return {
                appRelaunched: true,
                runtimeRestarted: true,
                runtimeEvidence: {
                    anonymousSignupEnabled: false,
                    canonicalServerUrl,
                    healthy: true,
                    readiness: { homeServerIdentityId },
                },
                preservationEvidence: {
                    configSha256: 'config-sha256',
                    databaseBytes: 4096,
                    masterSecretSha256: 'master-secret-sha256',
                    purpose: 'personal-home',
                },
                sessionEvidence: {
                    sessionId: 'session-1',
                    transcriptPersisted: true,
                },
            };
        },
    });

    assert.deepEqual(calls, [
        `home backup --output ${backupPath}`,
        `home verify-backup ${backupPath}`,
        `home restore ${backupPath} --yes`,
        'restart-loaded-app-and-runtime',
    ]);
    assert.deepEqual(evidence, {
        archivePath: backupPath,
        archiveSha256: 'a'.repeat(64),
        appRelaunched: true,
        canonicalServerUrl,
        configRetained: true,
        dataAndSessionRetained: true,
        homeServerIdentityId,
        masterSecretRetained: true,
        runtimeRestarted: true,
        status: 'verified',
    });
});

function createDestructiveArbitrationHarness(overrides = {}) {
    const calls = [];
    const state = { armed: null, held: null, observedMutations: 0, uninstalled: false };
    let retryCount = 0;
    const base = {
        wait: async () => {},
        pollDelayMs: 0,
        enterErasedRecoveryState: async () => {
            calls.push('erase');
            return { erased: true };
        },
        waitForRetryAction: async () => {
            calls.push('wait-retry');
            return '[data-testid="personal-home-bootstrap-retry"]';
        },
        clickRetry: async (selector) => {
            retryCount += 1;
            calls.push(`retry:${selector}`);
            if (retryCount === 1 && state.armed) {
                // The real bootstrap runs its first durable mutation, then pauses before the second.
                state.observedMutations = state.armed.ordinal;
                state.held = { kind: state.armed.kind, ordinal: state.armed.ordinal };
            }
        },
        armMutationPause: async (request) => {
            calls.push(`arm:${request.kind}:${request.ordinal}`);
            state.armed = { kind: request.kind, ordinal: request.ordinal, expiresAtMs: Date.now() + 1_000 };
            return { ok: true, armed: state.armed, held: null, observedMutations: 0 };
        },
        readMutationPause: async () => ({
            ok: true,
            armed: state.armed,
            held: state.held,
            observedMutations: state.observedMutations,
        }),
        releaseMutationPause: async () => {
            calls.push('release');
            state.armed = null;
            state.held = null;
            state.observedMutations = 0;
            return { ok: true, armed: null, held: null, observedMutations: 0 };
        },
        uninstallRuntime: async () => {
            calls.push('uninstall');
            if (state.held == null) throw new Error('uninstall raced an unpaused bootstrap');
            state.uninstalled = true;
            return { ok: true };
        },
        readRuntimeEvidence: async () => {
            if (retryCount < 2) throw new Error('runtime is uninstalled');
            return {
                healthy: true,
                anonymousSignupEnabled: false,
                canonicalServerUrl: 'http://127.0.0.1:43123',
            };
        },
        verifySignupRefused: async (canonicalServerUrl) => {
            calls.push(`refused:${canonicalServerUrl}`);
            return { refused: true, status: 403 };
        },
    };
    return { calls, state, options: { ...base, ...overrides } };
}

test('personal-home loaded QA plan uses the production shell and settings projections as observable proof', () => {
    const disposableHome = join(tmpdir(), 'lane03-personal-home-qa-home');
    const plan = buildTauriPersonalHomeQaPlan({
        env: {
            HOME: disposableHome,
            HAPPIER_STACK_STACK: 'lane03-personal-home-qa',
            HAPPIER_STACK_TAURI_IDENTIFIER: 'com.happier.stack.lane03-personal-home-qa',
        },
    });

    assert.equal(plan.appIdentifier, 'com.happier.stack.lane03-personal-home-qa');
    assert.equal(
        plan.backupArchivePath,
        join(disposableHome, 'personal-home-qa-external-backups', 'personal-home-backup.tar'),
    );
    assert.deepEqual(plan.shellSelectors, [
        '[data-testid="desktop-sidebar-chrome"]',
        '[data-testid="desktop-collapsed-shell-chrome"]',
        '[data-testid="desktop-narrow-shell-chrome"]',
    ]);
    assert.equal(plan.updateSelector, '[data-testid="settings.localRelayRuntime.installOrUpdate"]');
    assert.equal(plan.uninstallSelector, '[data-testid="settings.personalHomeRuntime.uninstallRuntime"]');
    assert.equal(plan.recoveryRetrySelector, '[data-testid="personal-home-recovery-retry"]');
    assert.equal(plan.setupRetrySelector, '[data-testid="personal-home-bootstrap-retry"]');
    assert.equal(plan.bootstrapMutationKind, 'relay.runtime.installOrUpdate.v1');
    assert.equal(plan.bootstrapMutationPauseOrdinal, 2);
    assert.equal('scopedFailureProbe' in plan, false);
    assert.equal('bootstrapMutationInterruptionProbe' in plan, false);
    assert.equal(plan.forbiddenOnboardingSelector, '[data-testid="onboarding-wizard-welcome-auth"]');
});

test('personal-home loaded QA settings selectors name real production Personal Home boundaries', async () => {
    const plan = buildTauriPersonalHomeQaPlan({ env: {} });
    const sectionSource = await readFile(
        new URL('../../sources/components/settings/server/localControl/PersonalHomeRuntimeControlSection.tsx', import.meta.url),
        'utf8',
    );
    // The loaded run proves nothing when it waits on a selector the canonical settings owner
    // never renders, so the checked-in plan is bound to that production source rather than to
    // a literal restated here.
    for (const selector of [plan.personalHomeSettingsSelector, plan.uninstallSelector, plan.eraseSelector]) {
        const testId = /^\[data-testid="([^"]+)"\]$/u.exec(selector)?.[1];
        assert.ok(testId, `${selector} must be a stable data-testid selector`);
        assert.equal(
            sectionSource.includes(`testID="${testId}"`),
            true,
            `${testId} is not rendered by the canonical Personal Home settings section`,
        );
    }
});

test('personal-home loaded QA retry and profile-removal selectors name real production boundaries', async () => {
    const plan = buildTauriPersonalHomeQaPlan({ env: {} });
    const sources = await Promise.all([
        readFile(new URL('../../sources/components/personalHome/setup/PersonalHomeSetupFailure.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../../sources/components/personalHome/bootstrap/PersonalHomeRecoveryStrip.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../../sources/components/settings/server/localControl/PersonalHomeRuntimeControlSection.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../../sources/modal/components/WebAlertModal.tsx', import.meta.url), 'utf8'),
    ]);
    const combined = sources.join('\n');
    for (const selector of [
        plan.setupRetrySelector,
        plan.recoveryRetrySelector,
        plan.removeProfileSelector,
        plan.eraseSelector,
    ]) {
        const testId = /^\[data-testid="([^"]+)"\]$/u.exec(selector)?.[1];
        assert.ok(testId, `${selector} must be a stable data-testid selector`);
        assert.equal(
            combined.includes(`testID="${testId}"`),
            true,
            `${testId} is not rendered by a canonical Personal Home production surface`,
        );
    }
    // The erase/remove confirmations are canonical web-modal buttons, whose ids the modal owner
    // derives rather than spelling out literally.
    assert.equal(plan.eraseConfirmSelector, '[data-testid="web-modal-confirm"]');
    assert.equal(plan.removeProfileConfirmSelector, '[data-testid="web-modal-confirm"]');
    assert.equal(plan.eraseChoiceSelector, '[data-testid="web-modal-button-1"]');
    assert.equal(sources[3].includes('\'web-modal-confirm\''), true);
    assert.equal(sources[3].includes('`web-modal-button-${index}`'), true);
});

test('destructive arbitration proves the competing uninstall wins a paused bootstrap and Retry recovers', async () => {
    const harness = createDestructiveArbitrationHarness();
    const evidence = await verifyPersonalHomeDestructiveArbitrationRecovery(harness.options);

    assert.deepEqual(harness.calls, [
        'erase',
        'wait-retry',
        'arm:relay.runtime.installOrUpdate.v1:2',
        'retry:[data-testid="personal-home-bootstrap-retry"]',
        'uninstall',
        'release',
        'wait-retry',
        'retry:[data-testid="personal-home-bootstrap-retry"]',
        'refused:http://127.0.0.1:43123',
    ]);
    assert.equal(harness.state.uninstalled, true);
    assert.deepEqual(evidence, {
        blockedAfterCompetingUninstall: true,
        blockedRetrySelectorAfterArbitration: '[data-testid="personal-home-bootstrap-retry"]',
        blockedRetrySelectorAfterErase: '[data-testid="personal-home-bootstrap-retry"]',
        observedDurableMutationsBeforePause: 2,
        pausedMutationKind: 'relay.runtime.installOrUpdate.v1',
        pausedMutationOrdinal: 2,
        recoveredRuntimeEvidence: {
            healthy: true,
            anonymousSignupEnabled: false,
            canonicalServerUrl: 'http://127.0.0.1:43123',
        },
        signupRefusalAfterRecovery: { refused: true, status: 403 },
        status: 'verified',
        uninstallWonDuringPausedBootstrap: true,
    });
});

test('destructive arbitration fails closed when the real journey cannot be observed', async () => {
    await assert.rejects(
        () => verifyPersonalHomeDestructiveArbitrationRecovery({
            ...createDestructiveArbitrationHarness().options,
            uninstallRuntime: undefined,
        }),
        /real uninstallRuntime boundary/u,
    );

    // Never pauses: bootstrap would have raced through both durable mutations unobserved.
    await assert.rejects(
        () => verifyPersonalHomeDestructiveArbitrationRecovery({
            ...createDestructiveArbitrationHarness().options,
            clickRetry: async () => {},
            pauseTimeoutMs: 0,
        }),
        /never paused between its two durable runtime mutations/u,
    );

    // Bootstrap silently continued after the competing uninstall instead of blocking.
    const continued = createDestructiveArbitrationHarness();
    let retryWaits = 0;
    continued.options.waitForRetryAction = async () => {
        retryWaits += 1;
        if (retryWaits === 1) return '[data-testid="personal-home-bootstrap-retry"]';
        return '';
    };
    await assert.rejects(
        () => verifyPersonalHomeDestructiveArbitrationRecovery(continued.options),
        /instead of blocking for a deliberate Retry/u,
    );

    // The erase step must reach the explicit erased recovery state, not report success blindly.
    await assert.rejects(
        () => verifyPersonalHomeDestructiveArbitrationRecovery({
            ...createDestructiveArbitrationHarness().options,
            enterErasedRecoveryState: async () => ({ erased: false }),
        }),
        /explicit erased recovery state/u,
    );

    // Recovery must be proven from real runtime evidence, not from the retry click alone.
    await assert.rejects(
        () => verifyPersonalHomeDestructiveArbitrationRecovery({
            ...createDestructiveArbitrationHarness().options,
            readRuntimeEvidence: async () => ({ healthy: true, anonymousSignupEnabled: true }),
            recoveryTimeoutMs: 0,
        }),
        /did not recover the Personal Home to its ready state/u,
    );
});

test('personal-home loaded QA ignores externally supplied executable probes instead of accepting self-attested outcomes', () => {
    const plan = buildTauriPersonalHomeQaPlan({
        env: {
            HAPPIER_TAURI_PERSONAL_HOME_QA_SCOPED_FAILURE_PROBE_SCRIPT: 'window.existingDaemonFailureProbe()',
            HAPPIER_TAURI_PERSONAL_HOME_QA_BOOTSTRAP_MUTATION_PROBE_SCRIPT: 'window.existingBootstrapMutationProbe()',
        },
    });

    assert.equal('scopedFailureProbe' in plan, false);
    assert.equal('bootstrapMutationInterruptionProbe' in plan, false);
    assert.equal(JSON.stringify(plan).includes('existingDaemonFailureProbe'), false);
    assert.equal(JSON.stringify(plan).includes('existingBootstrapMutationProbe'), false);
});

test('personal-home loaded QA has no caller-attested completion mode', () => {
    const source = new URL('./tauriPersonalHomeMcpQa.mjs', import.meta.url);
    assert.equal(source.pathname.endsWith('tauriPersonalHomeMcpQa.mjs'), true);
    assert.equal('verificationStatus' in buildTauriPersonalHomeQaPlan({}), false);
});

test('personal-home app relaunch requires the same disposable OS home and persisted profile, credential, and session marker', async () => {
    const initialEnv = {
        HOME: '/tmp/happier-personal-home-fresh',
        USERPROFILE: '/tmp/happier-personal-home-fresh',
    };
    let relaunchCalls = 0;
    const evidence = await verifyPersonalHomeAppRelaunch({
        env: initialEnv,
        relaunchApp: async () => {
            relaunchCalls += 1;
            return { env: { ...initialEnv, HAPPIER_TAURI_MCP_PORT: '9444' } };
        },
        verifyAfterRelaunch: async () => ({
            credentialAuthenticated: true,
            profileAvailable: true,
            sessionMarkerPersisted: true,
        }),
    });
    assert.equal(relaunchCalls, 1);
    assert.deepEqual(evidence, {
        credentialAuthenticated: true,
        profileAvailable: true,
        sameDisposableHome: true,
        sessionMarkerPersisted: true,
        status: 'verified',
    });

    await assert.rejects(
        () => verifyPersonalHomeAppRelaunch({
            env: initialEnv,
            relaunchApp: async () => ({ env: { ...initialEnv, HOME: '/tmp/other-home' } }),
            verifyAfterRelaunch: async () => ({
                credentialAuthenticated: true,
                profileAvailable: true,
                sessionMarkerPersisted: true,
            }),
        }),
        /same disposable OS home/u,
    );
    await assert.rejects(
        () => verifyPersonalHomeAppRelaunch({
            env: initialEnv,
            relaunchApp: async () => ({ env: initialEnv }),
            verifyAfterRelaunch: async () => ({
                credentialAuthenticated: true,
                profileAvailable: true,
                sessionMarkerPersisted: false,
            }),
        }),
        /profile, credential, and session marker/u,
    );
});

test('preservation evidence fingerprints config/master-secret and requires the database and classification state', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'tauri-personal-home-preservation-'));
    const installRoot = join(homeDir, '.happier', 'self-host');
    const configDir = join(installRoot, 'config');
    const dataDir = join(installRoot, 'data');
    await mkdir(configDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(installRoot, 'self-host-state.json'), JSON.stringify({ purpose: { kind: 'personal-home' } }));
    await writeFile(join(configDir, 'server.env'), 'AUTH_ANONYMOUS_SIGNUP_ENABLED=0\n');
    await writeFile(join(dataDir, 'happier-server-light.sqlite'), 'database');
    await writeFile(join(dataDir, 'handy-master-secret.txt'), 'secret');

    const evidence = await inspectPersonalHomePreservationEvidence({ env: { HOME: homeDir } });
    assert.deepEqual(evidence, {
        configBytes: 32,
        configSha256: 'ded6c5ba61c6870401f27830bdd650534d626302907e135ddade1943435beaac',
        databaseBytes: 8,
        masterSecretBytes: 6,
        masterSecretSha256: '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b',
        purpose: 'personal-home',
    });
    await rm(join(configDir, 'server.env'));
    await assert.rejects(
        inspectPersonalHomePreservationEvidence({ env: { HOME: homeDir } }),
        /ENOENT/u,
    );
});

test('anonymous signup evidence performs a valid fresh-key attempt and requires the live signup-disabled response', async () => {
    let observed = null;
    const evidence = await verifyAnonymousSignupRefused({
        canonicalServerUrl: 'http://127.0.0.1:43123',
        fetchImpl: async (url, init) => {
            observed = { url: String(url), init, body: JSON.parse(String(init.body)) };
            return new Response(JSON.stringify({ error: 'signup-disabled' }), {
                status: 403,
                headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.equal(observed.url, 'http://127.0.0.1:43123/v1/auth');
    assert.equal(observed.init.method, 'POST');
    assert.equal(Buffer.from(observed.body.publicKey, 'base64').byteLength, 32);
    assert.equal(Buffer.from(observed.body.challenge, 'base64').byteLength, 32);
    assert.equal(Buffer.from(observed.body.signature, 'base64').byteLength, 64);
    assert.deepEqual(evidence, { refused: true, status: 403 });
});

test('session evidence requires the created session and marker in persisted transcript history', async () => {
    const calls = [];
    const runCliJson = async (args) => {
        calls.push(args);
        if (args[1] === 'create') return { ok: true, kind: 'session_create', data: { session: { id: 'sess_lane03' } } };
        if (args[1] === 'history') return { ok: true, kind: 'session_history', data: { sessionId: 'sess_lane03', messages: [{ role: 'user', text: 'lane03-marker' }] } };
        if (args[1] === 'list') return { ok: true, kind: 'session_list', data: { sessions: [{ id: 'sess_lane03' }] } };
        throw new Error(`unexpected command ${args.join(' ')}`);
    };
    const evidence = await verifyPersonalHomeSessionEvidence({
        agentId: 'codex',
        marker: 'lane03-marker',
        runCliJson,
        sessionPath: '/tmp/lane03-session',
    });
    assert.deepEqual(evidence, { marker: 'lane03-marker', sessionId: 'sess_lane03', transcriptPersisted: true });
    assert.deepEqual(calls, [
        ['session', 'create', '--path', '/tmp/lane03-session', '--agent', 'codex', '--prompt', 'lane03-marker'],
        ['session', 'history', 'sess_lane03', '--tail', '100'],
    ]);
});

test('runtime evidence inspection proves the persisted purpose, closure, listener receipt, and live health without exposing credentials', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'tauri-personal-home-evidence-'));
    const installRoot = join(homeDir, '.happier', 'self-host');
    const configDir = join(installRoot, 'config');
    const dataDir = join(installRoot, 'data');
    await mkdir(configDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    writePersonalHomeIdentity(join(dataDir, 'happier-server-light.sqlite'), 'home_fixture');
    await writeFile(join(installRoot, 'self-host-state.json'), JSON.stringify({
        version: '0.3.0-test',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
    }));
    await writeFile(join(configDir, 'server.env'), [
        'HAPPIER_SERVER_HOST=127.0.0.1',
        'HAPPIER_CANONICAL_SERVER_URL=http://127.0.0.1:43123',
        'PORT=43123',
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
        'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    ].join('\n'));
    await writeFile(join(dataDir, 'startup-receipt.json'), JSON.stringify({
        pid: process.pid,
        nonce: 'fixture',
        host: '127.0.0.1',
        port: 43123,
        personalHomeReadiness: {
            authenticated: true,
            homeServerIdentityId: 'home_fixture',
            accountCount: 1,
            sessionCount: 0,
            teamsBootstrapStatus: 'ready',
        },
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
        listener: { host: '127.0.0.1', pid: process.pid, port: 43123 },
        purpose: 'personal-home',
        receiptNoncePresent: true,
        receiptNonceSha256: 'f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d',
        readiness: {
            authenticated: true,
            homeServerIdentityId: 'home_fixture',
            accountCount: 1,
            sessionCount: 0,
            teamsBootstrapStatus: 'ready',
        },
        storagePolicy: 'plaintext_only',
        version: '0.3.0-test',
    });
    assert.equal(JSON.stringify(evidence).includes('token'), false);
    assert.equal(JSON.stringify(evidence).includes('secret'), false);
});

test('runtime evidence rejects weaker loopback aliases and receipts without canonical authenticated readiness', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'tauri-personal-home-strict-evidence-'));
    const installRoot = join(homeDir, '.happier', 'self-host');
    const configDir = join(installRoot, 'config');
    const dataDir = join(installRoot, 'data');
    await mkdir(configDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    writePersonalHomeIdentity(join(dataDir, 'happier-server-light.sqlite'), 'home_fixture');
    await writeFile(join(installRoot, 'self-host-state.json'), JSON.stringify({
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
    }));
    await writeFile(join(configDir, 'server.env'), [
        'HAPPIER_SERVER_HOST=127.0.0.1',
        'HAPPIER_CANONICAL_SERVER_URL=http://127.0.0.1:43123',
        'PORT=43123',
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
        'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    ].join('\n'));
    const receiptPath = join(dataDir, 'startup-receipt.json');
    const writeReceipt = async (overrides = {}) => await writeFile(receiptPath, JSON.stringify({
        pid: process.pid,
        nonce: 'fixture',
        host: '127.0.0.1',
        port: 43123,
        personalHomeReadiness: {
            authenticated: true,
            homeServerIdentityId: 'home_fixture',
            accountCount: 1,
            sessionCount: 0,
            teamsBootstrapStatus: 'ready',
        },
        ...overrides,
    }));
    const options = {
        env: { HOME: homeDir },
        fetchImpl: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    };

    await writeReceipt({ host: 'localhost' });
    await assert.rejects(() => inspectPersonalHomeRuntimeEvidence(options), /stable loopback origin/u);

    await writeReceipt({ personalHomeReadiness: undefined });
    await assert.rejects(() => inspectPersonalHomeRuntimeEvidence(options), /authenticated readiness/u);

    await writeReceipt({ personalHomeReadiness: {
        authenticated: true,
        homeServerIdentityId: 'home_fixture',
        accountCount: 1,
        sessionCount: 0,
    } });
    await assert.rejects(() => inspectPersonalHomeRuntimeEvidence(options), /H6 Teams bootstrap.*ready/u);

    await writeReceipt({ personalHomeReadiness: {
        authenticated: true,
        homeServerIdentityId: 'home_fixture',
        accountCount: 2,
        sessionCount: 0,
        teamsBootstrapStatus: 'setup_required',
    } });
    await assert.rejects(() => inspectPersonalHomeRuntimeEvidence(options), /H6 Teams bootstrap.*ready/u);

    await writeReceipt({ nonce: '' });
    await assert.rejects(() => inspectPersonalHomeRuntimeEvidence(options), /startup receipt nonce/u);

    await writeReceipt({ personalHomeReadiness: {
        authenticated: true,
        homeServerIdentityId: 'home_other',
        accountCount: 1,
        sessionCount: 0,
        teamsBootstrapStatus: 'ready',
    } });
    await assert.rejects(() => inspectPersonalHomeRuntimeEvidence(options), /canonical Home identity/u);

    await writeReceipt();
    await writeFile(join(configDir, 'server.env'), [
        'HAPPIER_SERVER_HOST=127.0.0.1',
        'HAPPIER_CANONICAL_SERVER_URL=http://127.0.0.1:43123',
        'PORT=43124',
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        'HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only',
        'HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain',
    ].join('\n'));
    await assert.rejects(() => inspectPersonalHomeRuntimeEvidence(options), /managed environment.*stable loopback origin/u);
});

test('restart evidence waits for a new loaded server process while preserving closure', async () => {
    const observations = [
        { listener: { pid: 123 }, anonymousSignupEnabled: false, healthy: true, receiptNonceSha256: 'old' },
        { listener: { pid: 456 }, anonymousSignupEnabled: false, healthy: true, receiptNonceSha256: 'new' },
    ];
    const waits = [];

    const evidence = await waitForRestartedPersonalHomeEvidence({
        initialPid: 123,
        initialReceiptNonceSha256: 'old',
        requireChangedReceiptNonce: true,
        readEvidence: async () => observations.shift(),
        wait: async (milliseconds) => waits.push(milliseconds),
        pollDelayMs: 25,
        timeoutMs: 100,
    });

    assert.equal(evidence.listener.pid, 456);
    assert.deepEqual(waits, [25]);
});

test('restart evidence accepts a service restart that replays its persisted startup nonce', async () => {
    // `relay.runtime.restart.v1` relaunches the existing service definition, and the startup
    // nonce is written into that definition when the runtime is installed. Only the live process
    // can change across a plain restart, so demanding a new nonce here would be untruthful.
    const observations = [
        { listener: { pid: 123 }, anonymousSignupEnabled: false, healthy: true, receiptNonceSha256: 'installed' },
        { listener: { pid: 456 }, anonymousSignupEnabled: false, healthy: true, receiptNonceSha256: 'installed' },
    ];

    const evidence = await waitForRestartedPersonalHomeEvidence({
        initialPid: 123,
        initialReceiptNonceSha256: 'installed',
        readEvidence: async () => observations.shift(),
        wait: async () => {},
        pollDelayMs: 5,
        timeoutMs: 100,
    });

    assert.equal(evidence.listener.pid, 456);
});

test('restart evidence rejects a reinstall that never re-rendered its startup nonce', async () => {
    await assert.rejects(() => waitForRestartedPersonalHomeEvidence({
        initialPid: 123,
        initialReceiptNonceSha256: 'installed',
        requireChangedReceiptNonce: true,
        readEvidence: async () => ({
            listener: { pid: 456 },
            anonymousSignupEnabled: false,
            healthy: true,
            receiptNonceSha256: 'installed',
        }),
        wait: async () => {},
        pollDelayMs: 5,
        timeoutMs: 30,
    }), /new process after restart/u);
});

test('restart evidence rejects a receipt that carries no startup nonce at all', async () => {
    await assert.rejects(() => waitForRestartedPersonalHomeEvidence({
        initialPid: 123,
        initialReceiptNonceSha256: 'installed',
        readEvidence: async () => ({ listener: { pid: 456 }, anonymousSignupEnabled: false, healthy: true }),
        wait: async () => {},
        pollDelayMs: 5,
        timeoutMs: 30,
    }), /new process after restart/u);
});
