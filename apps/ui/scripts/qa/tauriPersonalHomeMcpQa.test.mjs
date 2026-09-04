import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    buildTauriPersonalHomeQaPlan,
    derivePersonalHomeVerificationStatus,
    inspectPersonalHomePreservationEvidence,
    inspectPersonalHomeRuntimeEvidence,
    assertPersonalHomeQaCompleteVerification,
    validateTauriPersonalHomeQaProbeResult,
    verifyPersonalHomeAppRelaunch,
    verifyAnonymousSignupRefused,
    verifyPersonalHomeSessionEvidence,
    waitForRestartedPersonalHomeEvidence,
} from './tauriPersonalHomeMcpQa.mjs';

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
    assert.deepEqual(plan.shellSelectors, [
        '[data-testid="desktop-sidebar-chrome"]',
        '[data-testid="desktop-collapsed-shell-chrome"]',
        '[data-testid="desktop-narrow-shell-chrome"]',
    ]);
    assert.equal(plan.personalHomeSettingsSelector, '[data-testid="settings.personalHomeRuntime.identity"]');
    assert.equal(plan.updateSelector, '[data-testid="settings.localRelayRuntime.installOrUpdate"]');
    assert.equal(plan.uninstallSelector, '[data-testid="settings.personalHomeRuntime.uninstallRuntime"]');
    assert.equal(plan.recoveryRetrySelector, '[data-testid="personal-home-recovery-retry"]');
    assert.deepEqual(plan.scopedFailureProbe, {
        configured: false,
        unavailableReason: 'Set HAPPIER_TAURI_PERSONAL_HOME_QA_SCOPED_FAILURE_PROBE_SCRIPT to invoke an existing scoped daemon-failure boundary in the loaded app.',
    });
    assert.deepEqual(plan.bootstrapMutationInterruptionProbe, {
        configured: false,
        unavailableReason: 'Set HAPPIER_TAURI_PERSONAL_HOME_QA_BOOTSTRAP_MUTATION_PROBE_SCRIPT to pause bootstrap at an existing between-mutations boundary before exercising uninstall or erase.',
    });
    assert.equal(plan.forbiddenOnboardingSelector, '[data-testid="onboarding-wizard-welcome-auth"]');
});

test('personal-home loaded QA records externally supplied failure probes without leaking their executable source', () => {
    const plan = buildTauriPersonalHomeQaPlan({
        env: {
            HAPPIER_TAURI_PERSONAL_HOME_QA_SCOPED_FAILURE_PROBE_SCRIPT: 'window.existingDaemonFailureProbe()',
            HAPPIER_TAURI_PERSONAL_HOME_QA_BOOTSTRAP_MUTATION_PROBE_SCRIPT: 'window.existingBootstrapMutationProbe()',
        },
    });

    assert.deepEqual(plan.scopedFailureProbe, { configured: true });
    assert.deepEqual(plan.bootstrapMutationInterruptionProbe, { configured: true });
    assert.equal(JSON.stringify(plan).includes('existingDaemonFailureProbe'), false);
    assert.equal(JSON.stringify(plan).includes('existingBootstrapMutationProbe'), false);
});

test('personal-home loaded QA complete mode rejects partial verification without changing diagnostic partial reporting', () => {
    assert.doesNotThrow(() => assertPersonalHomeQaCompleteVerification({
        requireComplete: false,
        verificationStatus: 'partial',
    }));
    assert.doesNotThrow(() => assertPersonalHomeQaCompleteVerification({
        requireComplete: true,
        verificationStatus: 'complete',
    }));
    assert.throws(
        () => assertPersonalHomeQaCompleteVerification({
            requireComplete: true,
            verificationStatus: 'partial',
        }),
        /requires complete verification/u,
    );
});

test('personal-home completion requires fresh launch and temporal bootstrap observation', () => {
    const completeEvidence = {
        appRelaunchEvidence: { status: 'verified' },
        bootstrapMutationInterruptionEvidence: { status: 'verified' },
        freshBootstrapEvidence: { prelaunchFactsEmpty: true },
        noOnboardingObservation: { documentStart: true, installed: true, seen: false, observations: 2 },
        scopedDaemonFailureEvidence: { status: 'verified' },
    };
    assert.equal(derivePersonalHomeVerificationStatus(completeEvidence), 'complete');
    assert.equal(derivePersonalHomeVerificationStatus({
        ...completeEvidence,
        appRelaunchEvidence: { status: 'unavailable' },
    }), 'partial');
    assert.equal(derivePersonalHomeVerificationStatus({
        ...completeEvidence,
        freshBootstrapEvidence: { prelaunchFactsEmpty: false },
    }), 'partial');
    assert.equal(derivePersonalHomeVerificationStatus({
        ...completeEvidence,
        noOnboardingObservation: { documentStart: false, installed: true, seen: false, observations: 2 },
    }), 'partial');
    assert.equal(derivePersonalHomeVerificationStatus({
        ...completeEvidence,
        noOnboardingObservation: { documentStart: true, installed: true, seen: true, observations: 2 },
    }), 'partial');
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

test('personal-home loaded QA only accepts external probes that prove the intended scoped boundary', () => {
    assert.deepEqual(
        validateTauriPersonalHomeQaProbeResult({ ok: true, scenario: 'daemon-failure', retryAvailable: true }, 'daemon-failure'),
        { scenario: 'daemon-failure', retryAvailable: true },
    );
    assert.deepEqual(
        validateTauriPersonalHomeQaProbeResult({
            ok: true,
            scenario: 'bootstrap-mutation-interruption',
            phase: 'between-bootstrap-mutations',
            operation: 'erase',
        }, 'bootstrap-mutation-interruption'),
        { operation: 'erase', phase: 'between-bootstrap-mutations', scenario: 'bootstrap-mutation-interruption' },
    );
    assert.throws(
        () => validateTauriPersonalHomeQaProbeResult({ ok: true, scenario: 'daemon-failure', retryAvailable: false }, 'daemon-failure'),
        /actionable Retry/u,
    );
    assert.throws(
        () => validateTauriPersonalHomeQaProbeResult({
            ok: true,
            scenario: 'bootstrap-mutation-interruption',
            phase: 'after-bootstrap',
            operation: 'uninstall',
        }, 'bootstrap-mutation-interruption'),
        /between-mutations uninstall or erase boundary/u,
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
        ['session', 'list', '--limit', '100'],
    ]);
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
        listener: { host: '127.0.0.1', pid: 123, port: 43123 },
        purpose: 'personal-home',
        storagePolicy: 'plaintext_only',
        version: '0.3.0-test',
    });
    assert.equal(JSON.stringify(evidence).includes('token'), false);
    assert.equal(JSON.stringify(evidence).includes('secret'), false);
});

test('restart evidence waits for a new loaded server process while preserving closure', async () => {
    const observations = [
        { listener: { pid: 123 }, anonymousSignupEnabled: false, healthy: true },
        { listener: { pid: 456 }, anonymousSignupEnabled: false, healthy: true },
    ];
    const waits = [];

    const evidence = await waitForRestartedPersonalHomeEvidence({
        initialPid: 123,
        readEvidence: async () => observations.shift(),
        wait: async (milliseconds) => waits.push(milliseconds),
        pollDelayMs: 25,
        maxAttempts: 3,
    });

    assert.equal(evidence.listener.pid, 456);
    assert.deepEqual(waits, [25]);
});
