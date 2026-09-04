#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

import {
    ensureDir,
    nowStamp,
    runTauriMcpCli,
    writeTextArtifact,
} from './tauriMcpCli.mjs';
import { appendTauriQaHmrOptOut } from './tauriQaPathing.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(dirname(scriptDir));
const repoRoot = dirname(dirname(packageRoot));
const execFileAsync = promisify(execFile);
const shellWaitTimeoutMs = 360_000;
const cliTimeoutMs = 30_000;
const scopedFailureProbeEnvKey = 'HAPPIER_TAURI_PERSONAL_HOME_QA_SCOPED_FAILURE_PROBE_SCRIPT';
const bootstrapMutationProbeEnvKey = 'HAPPIER_TAURI_PERSONAL_HOME_QA_BOOTSTRAP_MUTATION_PROBE_SCRIPT';

function readString(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function parseEnvText(text) {
    const result = {};
    for (const line of String(text ?? '').split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const equals = trimmed.indexOf('=');
        if (equals <= 0) continue;
        result[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
    }
    return result;
}

function resolveRuntimePaths(env = process.env) {
    const userHome = readString(env.HOME ?? env.USERPROFILE, homedir());
    const installRoot = readString(env.HAPPIER_SELF_HOST_INSTALL_ROOT, join(userHome, '.happier', 'self-host'));
    const configDir = readString(env.HAPPIER_SELF_HOST_CONFIG_DIR, join(installRoot, 'config'));
    const dataDir = readString(
        env.HAPPIER_SERVER_LIGHT_DATA_DIR ?? env.HAPPY_SERVER_LIGHT_DATA_DIR,
        join(installRoot, 'data'),
    );
    return { configDir, dataDir, installRoot };
}

async function fingerprintFile(path) {
    const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
    if (!metadata.isFile() || metadata.size <= 0) {
        throw new Error(`Personal Home preservation evidence is missing a non-empty file: ${path}`);
    }
    return { bytes: metadata.size, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function inspectPersonalHomePreservationEvidence({ env = process.env } = {}) {
    const paths = resolveRuntimePaths(env);
    const state = JSON.parse(await readFile(join(paths.installRoot, 'self-host-state.json'), 'utf8'));
    if (state?.purpose?.kind !== 'personal-home') {
        throw new Error('Loaded runtime did not preserve its Personal Home classification.');
    }
    const [config, database, masterSecret] = await Promise.all([
        fingerprintFile(join(paths.configDir, 'server.env')),
        stat(join(paths.dataDir, 'happier-server-light.sqlite')),
        fingerprintFile(join(paths.dataDir, 'handy-master-secret.txt')),
    ]);
    if (!database.isFile() || database.size <= 0) {
        throw new Error('Loaded Personal Home database is missing or empty.');
    }
    return {
        configBytes: config.bytes,
        configSha256: config.sha256,
        databaseBytes: database.size,
        masterSecretBytes: masterSecret.bytes,
        masterSecretSha256: masterSecret.sha256,
        purpose: 'personal-home',
    };
}

export async function verifyAnonymousSignupRefused({ canonicalServerUrl, fetchImpl = fetch }) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
    const challenge = randomBytes(32);
    const response = await fetchImpl(new URL('/v1/auth', canonicalServerUrl), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
            publicKey: publicKeyDer.subarray(publicKeyDer.length - 32).toString('base64'),
            challenge: challenge.toString('base64'),
            signature: sign(null, challenge, privateKey).toString('base64'),
        }),
        signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (response.status !== 403 || payload?.error !== 'signup-disabled') {
        throw new Error(`Loaded Personal Home accepted or misreported anonymous signup (HTTP ${response.status}).`);
    }
    return { refused: true, status: 403 };
}

function findJsonPayload(text) {
    const lines = String(text ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            const parsed = JSON.parse(lines[index]);
            if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
                return findJsonPayload(parsed.text);
            }
            return parsed;
        } catch {
            // The development CLI may emit setup text before its final JSON payload.
        }
    }
    throw new Error('Happier CLI did not emit a JSON result.');
}

async function runPersonalHomeCliJson(args, { env = process.env } = {}) {
    const childEnv = { ...env };
    for (const key of Object.keys(childEnv)) {
        if (key.startsWith('HAPPIER_STACK_')) delete childEnv[key];
    }
    for (const key of [
        'HAPPIER_SERVER_URL',
        'HAPPY_SERVER_URL',
        'HAPPIER_TOKEN',
        'HAPPY_TOKEN',
        'HAPPIER_ACCOUNT_ID',
        'HAPPY_ACCOUNT_ID',
    ]) delete childEnv[key];
    const { stdout } = await execFileAsync(
        process.execPath,
        [join(repoRoot, 'apps', 'stack', 'scripts', 'happier.mjs'), ...args, '--json'],
        { cwd: repoRoot, env: childEnv, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return findJsonPayload(stdout);
}

export async function verifyPersonalHomeSessionEvidence({
    agentId,
    marker,
    runCliJson = runPersonalHomeCliJson,
    sessionId: requestedSessionId = null,
    sessionPath = repoRoot,
} = {}) {
    const normalizedMarker = readString(marker);
    if (!normalizedMarker) throw new Error('Personal Home session evidence requires a unique transcript marker.');
    let sessionId = readString(requestedSessionId);
    if (!sessionId) {
        const created = await runCliJson([
            'session', 'create', '--path', sessionPath, '--agent', readString(agentId, 'codex'), '--prompt', normalizedMarker,
        ]);
        sessionId = readString(created?.data?.session?.id);
        if (created?.ok !== true || created?.kind !== 'session_create' || !sessionId) {
            throw new Error('Personal Home loaded QA could not create a real agent session.');
        }
    }
    const history = await runCliJson(['session', 'history', sessionId, '--tail', '100']);
    if (history?.ok !== true || history?.kind !== 'session_history'
        || readString(history?.data?.sessionId) !== sessionId
        || !JSON.stringify(history?.data?.messages).includes(normalizedMarker)) {
        throw new Error('Personal Home session transcript did not retain its unique marker.');
    }
    const sessions = await runCliJson(['session', 'list', '--limit', '100']);
    if (sessions?.ok !== true || sessions?.kind !== 'session_list'
        || !sessions?.data?.sessions?.some((entry) => readString(entry?.id) === sessionId)) {
        throw new Error('Personal Home session was absent from the persisted session list.');
    }
    return { marker: normalizedMarker, sessionId, transcriptPersisted: true };
}

function requireLoopbackListener(host, port, canonicalServerUrl) {
    const normalizedHost = readString(host).replace(/^\[|\]$/gu, '').toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1'].includes(normalizedHost)) {
        throw new Error(`Personal Home startup receipt is not loopback-bound: ${normalizedHost || 'missing host'}`);
    }
    const parsedUrl = new URL(canonicalServerUrl);
    const expectedPort = Number(parsedUrl.port);
    if (!Number.isInteger(port) || port !== expectedPort) {
        throw new Error(`Personal Home startup receipt port ${port} does not match ${expectedPort}.`);
    }
    return { host: normalizedHost, port };
}

export async function inspectPersonalHomeRuntimeEvidence({
    env = process.env,
    fetchImpl = fetch,
} = {}) {
    const paths = resolveRuntimePaths(env);
    const state = JSON.parse(await readFile(join(paths.installRoot, 'self-host-state.json'), 'utf8'));
    const managedEnv = parseEnvText(await readFile(join(paths.configDir, 'server.env'), 'utf8'));
    const receipt = JSON.parse(await readFile(join(paths.dataDir, 'startup-receipt.json'), 'utf8'));
    const purpose = state?.purpose;
    const canonicalServerUrl = readString(purpose?.canonicalServerUrl);
    if (purpose?.kind !== 'personal-home' || !canonicalServerUrl) {
        throw new Error('Loaded runtime is not durably classified as Personal Home.');
    }
    if (managedEnv.AUTH_ANONYMOUS_SIGNUP_ENABLED !== '0') {
        throw new Error('Loaded Personal Home managed environment did not preserve signup closure.');
    }
    if (managedEnv.HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY !== 'plaintext_only') {
        throw new Error('Loaded Personal Home storage policy is not plaintext_only.');
    }
    if (managedEnv.HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE !== 'plain') {
        throw new Error('Loaded Personal Home default Account mode is not plain.');
    }
    const listenerAddress = requireLoopbackListener(receipt?.host, Number(receipt?.port), canonicalServerUrl);
    const listenerPid = Number(receipt?.pid);
    if (!Number.isSafeInteger(listenerPid) || listenerPid <= 0) {
        throw new Error('Personal Home startup receipt did not identify the loaded server process.');
    }
    const listener = { ...listenerAddress, pid: listenerPid };
    const healthResponse = await fetchImpl(new URL('/health', canonicalServerUrl), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
    });
    if (!healthResponse?.ok) {
        throw new Error(`Loaded Personal Home health check failed with HTTP ${healthResponse?.status ?? 'unknown'}.`);
    }
    return {
        anonymousSignupEnabled: false,
        canonicalServerUrl,
        defaultAccountMode: 'plain',
        healthy: true,
        listener,
        purpose: 'personal-home',
        storagePolicy: 'plaintext_only',
        version: readString(state?.version) || null,
    };
}

export async function waitForRestartedPersonalHomeEvidence({
    initialPid,
    readEvidence = async () => await inspectPersonalHomeRuntimeEvidence(),
    wait = delay,
    pollDelayMs = 1_000,
    maxAttempts = 120,
} = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const evidence = await readEvidence();
            if (evidence?.healthy === true
                && evidence?.anonymousSignupEnabled === false
                && Number(evidence?.listener?.pid) > 0
                && Number(evidence.listener.pid) !== Number(initialPid)) {
                return evidence;
            }
        } catch (error) {
            lastError = error;
        }
        if (attempt + 1 < maxAttempts) {
            // eslint-disable-next-line no-await-in-loop
            await wait(pollDelayMs);
        }
    }
    const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
    throw new Error(`Personal Home did not return healthy with a new process after restart.${detail}`);
}

function resolveArtifactRoot(env = process.env) {
    const explicit = readString(env.HAPPIER_TAURI_QA_OUTDIR);
    if (explicit) return isAbsolute(explicit) ? explicit : join(repoRoot, explicit);
    return join(repoRoot, '.project', 'logs', 'lane-03-personal-home-qa', `tauri-personal-home-${nowStamp()}`);
}

export function buildTauriPersonalHomeQaPlan({ env = process.env } = {}) {
    const appIdentifier = readString(env.HAPPIER_TAURI_MCP_APP_IDENTIFIER ?? env.HAPPIER_STACK_TAURI_IDENTIFIER);
    const scopedFailureProbeConfigured = Boolean(readString(env[scopedFailureProbeEnvKey]));
    const bootstrapMutationInterruptionProbeConfigured = Boolean(readString(env[bootstrapMutationProbeEnvKey]));
    return {
        appIdentifier,
        artifactRoot: resolveArtifactRoot(env),
        bootstrapMutationInterruptionProbe: bootstrapMutationInterruptionProbeConfigured
            ? { configured: true }
            : {
                configured: false,
                unavailableReason: `Set ${bootstrapMutationProbeEnvKey} to pause bootstrap at an existing between-mutations boundary before exercising uninstall or erase.`,
            },
        eraseConfirmSelector: '[data-testid="web-modal-confirm"]',
        eraseSelector: '[data-testid="settings.personalHomeRuntime.eraseData"]',
        forbiddenOnboardingSelector: '[data-testid="onboarding-wizard-welcome-auth"]',
        personalHomeSettingsSelector: '[data-testid="settings.personalHomeRuntime.identity"]',
        recoveryRetrySelector: '[data-testid="personal-home-recovery-retry"]',
        shellSelectors: [
            '[data-testid="desktop-sidebar-chrome"]',
            '[data-testid="desktop-collapsed-shell-chrome"]',
            '[data-testid="desktop-narrow-shell-chrome"]',
        ],
        setupSelector: '[data-testid="personal-home-bootstrap-phase"]',
        scopedFailureProbe: scopedFailureProbeConfigured
            ? { configured: true }
            : {
                configured: false,
                unavailableReason: `Set ${scopedFailureProbeEnvKey} to invoke an existing scoped daemon-failure boundary in the loaded app.`,
            },
        uninstallSelector: '[data-testid="settings.personalHomeRuntime.uninstallRuntime"]',
        updateSelector: '[data-testid="settings.localRelayRuntime.installOrUpdate"]',
        prerequisites: [
            'Run on a dedicated OS user or VM; the stable Personal Home service name is user-global.',
            'Use a unique stack-owned Tauri identifier and storage scope.',
            'Do not inject an existing stack server into the renderer; the Desktop bootstrap owner must select the local Home.',
            `${scopedFailureProbeEnvKey}, when supplied, must invoke an existing loaded-app daemon failure boundary and return { ok: true, scenario: 'daemon-failure', retryAvailable: true }.`,
            `${bootstrapMutationProbeEnvKey}, when supplied, must pause bootstrap at an existing mutation boundary and return { ok: true, scenario: 'bootstrap-mutation-interruption', phase: 'between-bootstrap-mutations', operation: 'uninstall' | 'erase' }.`,
        ],
    };
}

function isRecord(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function derivePersonalHomeVerificationStatus({
    appRelaunchEvidence,
    bootstrapMutationInterruptionEvidence,
    freshBootstrapEvidence,
    noOnboardingObservation,
    scopedDaemonFailureEvidence,
} = {}) {
    return appRelaunchEvidence?.status === 'verified'
        && freshBootstrapEvidence?.prelaunchFactsEmpty === true
        && noOnboardingObservation?.documentStart === true
        && noOnboardingObservation?.installed === true
        && noOnboardingObservation?.seen === false
        && Number.isSafeInteger(noOnboardingObservation?.observations)
        && noOnboardingObservation.observations >= 1
        && scopedDaemonFailureEvidence?.status === 'verified'
        && bootstrapMutationInterruptionEvidence?.status === 'verified'
        ? 'complete'
        : 'partial';
}

export async function verifyPersonalHomeAppRelaunch({
    env = process.env,
    relaunchApp,
    verifyAfterRelaunch,
} = {}) {
    if (typeof relaunchApp !== 'function') {
        throw new Error('Personal Home loaded QA requires its canonical launcher to terminate and relaunch the Tauri app.');
    }
    if (typeof verifyAfterRelaunch !== 'function') {
        throw new Error('Personal Home loaded QA requires post-relaunch persistence verification.');
    }
    const expectedHome = readString(env.HAPPIER_TAURI_PERSONAL_HOME_QA_HOME ?? env.HOME ?? env.USERPROFILE);
    const relaunched = await relaunchApp({ env });
    const relaunchedEnv = isRecord(relaunched?.env) ? relaunched.env : null;
    const relaunchedHome = readString(
        relaunchedEnv?.HAPPIER_TAURI_PERSONAL_HOME_QA_HOME
        ?? relaunchedEnv?.HOME
        ?? relaunchedEnv?.USERPROFILE,
    );
    if (!expectedHome || relaunchedHome !== expectedHome
        || readString(relaunchedEnv?.HOME) !== expectedHome
        || readString(relaunchedEnv?.USERPROFILE) !== expectedHome) {
        throw new Error('Personal Home Tauri relaunch did not preserve the same disposable OS home.');
    }
    const persisted = await verifyAfterRelaunch({ env: relaunchedEnv });
    if (persisted?.profileAvailable !== true
        || persisted?.credentialAuthenticated !== true
        || persisted?.sessionMarkerPersisted !== true) {
        throw new Error('Personal Home Tauri relaunch did not preserve the profile, credential, and session marker.');
    }
    return {
        credentialAuthenticated: true,
        profileAvailable: true,
        sameDisposableHome: true,
        sessionMarkerPersisted: true,
        status: 'verified',
    };
}

export function assertPersonalHomeQaCompleteVerification({ requireComplete = false, verificationStatus } = {}) {
    if (!requireComplete || verificationStatus === 'complete') {
        return;
    }
    throw new Error(`Personal Home QA requires complete verification; got ${String(verificationStatus ?? 'missing')}.`);
}

export function validateTauriPersonalHomeQaProbeResult(value, scenario) {
    if (!isRecord(value) || value.ok !== true || value.scenario !== scenario) {
        throw new Error(`Configured Personal Home QA ${scenario} probe did not report its expected existing boundary.`);
    }
    if (scenario === 'daemon-failure') {
        if (value.retryAvailable !== true) {
            throw new Error('Configured daemon-failure probe did not establish an actionable Retry state.');
        }
        return { scenario, retryAvailable: true };
    }
    if (value.phase !== 'between-bootstrap-mutations'
        || (value.operation !== 'uninstall' && value.operation !== 'erase')) {
        throw new Error('Configured bootstrap interruption probe did not stop at a between-mutations uninstall or erase boundary.');
    }
    return { operation: value.operation, phase: value.phase, scenario };
}

function cliEnv(env, appIdentifier) {
    return { ...env, HAPPIER_TAURI_MCP_APP_IDENTIFIER: appIdentifier };
}

async function runCli(args, { appIdentifier, env = process.env, timeoutMs = cliTimeoutMs } = {}) {
    return await runTauriMcpCli(args, {
        cwd: packageRoot,
        env: cliEnv(env, appIdentifier),
        timeoutMs,
    });
}

async function selectorPresent(selector, { appIdentifier, env, timeoutMs = 1_000 } = {}) {
    try {
        await runCli([
            'webview-wait-for', '--type', 'selector', '--strategy', 'css', '--value', selector,
            '--timeout', String(timeoutMs), '--app-identifier', appIdentifier,
        ], { appIdentifier, env, timeoutMs: Math.max(cliTimeoutMs, timeoutMs + 5_000) });
        return true;
    } catch {
        return false;
    }
}

async function startForbiddenSurfaceObservation(plan, { env } = {}) {
    const script = `(() => {
        const selector = ${JSON.stringify(plan.forbiddenOnboardingSelector)};
        const key = '__happierPersonalHomeQaForbiddenSurface';
        const previous = window[key];
        if (previous?.observer && previous?.state?.documentStart === true) return previous.state;
        if (previous?.observer) previous.observer.disconnect();
        const state = { seen: Boolean(document.querySelector(selector)), observations: 1, documentStart: false };
        const observer = new MutationObserver(() => {
            state.observations += 1;
            if (document.querySelector(selector)) state.seen = true;
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        window[key] = { observer, state };
        return state;
    })()`;
    await runCli([
        'webview-execute-js', '--script', script, '--app-identifier', plan.appIdentifier, '--json',
    ], { appIdentifier: plan.appIdentifier, env });
}

async function finishForbiddenSurfaceObservation(plan, { env } = {}) {
    const script = `(() => {
        const value = window.__happierPersonalHomeQaForbiddenSurface;
        if (!value) return { documentStart: false, installed: false, seen: false, observations: 0 };
        value.observer?.disconnect();
        return { documentStart: value.state.documentStart === true, installed: true, seen: value.state.seen === true, observations: value.state.observations };
    })()`;
    const result = await runCli([
        'webview-execute-js', '--script', script, '--app-identifier', plan.appIdentifier, '--json',
    ], { appIdentifier: plan.appIdentifier, env });
    const payload = findJsonPayload(result.stdout);
    const facts = isRecord(payload?.data) ? payload.data : payload;
    if (facts?.installed !== true || facts?.seen === true || !Number.isSafeInteger(facts?.observations) || facts.observations < 1) {
        throw new Error(facts?.seen === true
            ? 'Retired pre-auth onboarding appeared during Personal Home bootstrap.'
            : 'Continuous Personal Home onboarding observation was not active through shell readiness.');
    }
    return facts;
}

async function waitForAnyShell(plan, { env } = {}) {
    const deadline = Date.now() + shellWaitTimeoutMs;
    while (Date.now() < deadline) {
        for (const selector of plan.shellSelectors) {
            // eslint-disable-next-line no-await-in-loop
            if (await selectorPresent(selector, { appIdentifier: plan.appIdentifier, env, timeoutMs: 1_000 })) {
                return selector;
            }
        }
        // eslint-disable-next-line no-await-in-loop
        await delay(500);
    }
    throw new Error('Timed out waiting for the real Desktop shell after Personal Home bootstrap.');
}

async function navigate(pathname, { appIdentifier, env } = {}) {
    const target = appendTauriQaHmrOptOut(pathname);
    const script = `(() => { window.history.pushState({}, '', ${JSON.stringify(target)}); window.dispatchEvent(new PopStateEvent('popstate')); return window.location.pathname; })()`;
    await runCli([
        'webview-execute-js', '--script', script, '--app-identifier', appIdentifier, '--json',
    ], { appIdentifier, env });
}

async function clickSelector(selector, { appIdentifier, env } = {}) {
    await runCli([
        'webview-wait-for', '--type', 'selector', '--strategy', 'css', '--value', selector,
        '--timeout', '30000', '--app-identifier', appIdentifier,
    ], { appIdentifier, env });
    await runCli([
        'webview-interact', '--action', 'click', '--selector', selector,
        '--app-identifier', appIdentifier,
    ], { appIdentifier, env });
}

async function ensureSessionVisible(sessionId, plan, { env } = {}) {
    const script = `(async () => {
        const sessionId = ${JSON.stringify(sessionId)};
        const mcp = window.__MCP__;
        if (!mcp || typeof mcp.ensureHappierSessionVisible !== 'function') {
            return { ok: false, reason: 'missing-session-visibility-hook' };
        }
        return await mcp.ensureHappierSessionVisible(sessionId, { forceRefresh: true });
    })()`;
    await runCli([
        'webview-execute-js', '--script', script, '--app-identifier', plan.appIdentifier, '--json',
    ], { appIdentifier: plan.appIdentifier, env, timeoutMs: 120_000 });
    if (!(await selectorPresent('[data-testid="transcript-chat-list"]', {
        appIdentifier: plan.appIdentifier,
        env,
        timeoutMs: 30_000,
    }))) {
        throw new Error('The loaded Desktop shell did not render the real persisted session transcript.');
    }
}

async function runLoadedSystemTask(kind, plan, { env = process.env } = {}) {
    const channel = readString(env.HAPPIER_TAURI_PERSONAL_HOME_QA_CHANNEL, 'stable');
    const spec = {
        protocolVersion: 1,
        kind,
        params: { channel, target: { kind: 'local' }, surface: 'desktop.ui', mode: 'user' },
    };
    const script = `(async () => {
        const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
        if (typeof invoke !== 'function') return { ok: false, reason: 'missing-tauri-invoke' };
        const started = await invoke('start_system_task', { specJson: JSON.stringify(${JSON.stringify(spec)}) });
        for (let attempt = 0; attempt < 600; attempt += 1) {
            const snapshot = await invoke('get_system_task_snapshot', { taskId: started.taskId });
            if (snapshot && snapshot.result) return snapshot.result;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return { ok: false, reason: 'system-task-timeout', taskId: started.taskId };
    })()`;
    const result = await runCli([
        'webview-execute-js', '--script', script, '--app-identifier', plan.appIdentifier, '--json',
    ], { appIdentifier: plan.appIdentifier, env, timeoutMs: 180_000 });
    const payload = findJsonPayload(result.stdout);
    if (payload?.ok !== true) {
        throw new Error(`Loaded system task ${kind} failed: ${readString(payload?.error?.message ?? payload?.reason, 'unknown')}`);
    }
    return payload.data ?? {};
}

async function runConfiguredQaProbe(scriptSource, plan, { env = process.env } = {}) {
    const result = await runCli([
        'webview-execute-js',
        '--script', `(async () => await (${scriptSource}))()`,
        '--app-identifier', plan.appIdentifier,
        '--json',
    ], { appIdentifier: plan.appIdentifier, env, timeoutMs: 120_000 });
    const payload = findJsonPayload(result.stdout);
    return isRecord(payload?.data) ? payload.data : payload;
}

async function verifyConfiguredScopedDaemonFailure(plan, expectedMachineId, { env = process.env } = {}) {
    const probeScript = readString(env[scopedFailureProbeEnvKey]);
    if (!probeScript) {
        return {
            status: 'unavailable',
            reason: plan.scopedFailureProbe.unavailableReason,
        };
    }
    validateTauriPersonalHomeQaProbeResult(
        await runConfiguredQaProbe(probeScript, plan, { env }),
        'daemon-failure',
    );
    if (!(await selectorPresent('[data-testid="transcript-chat-list"]', {
        appIdentifier: plan.appIdentifier,
        env,
        timeoutMs: 5_000,
    })) || !(await waitForAnyShell(plan, { env }))) {
        throw new Error('Scoped daemon failure removed the usable Personal Home shell or session transcript.');
    }
    await clickSelector(plan.recoveryRetrySelector, { appIdentifier: plan.appIdentifier, env });
    const recovered = await waitForDaemonRecovered(expectedMachineId, plan, { env });
    return {
        daemonRunningAfterRetry: recovered.daemonRunning === true,
        sameMachineIdAfterRetry: readString(recovered.machineId) === expectedMachineId,
        status: 'verified',
    };
}

async function verifyConfiguredBootstrapMutationInterruption(plan, { env = process.env } = {}) {
    const probeScript = readString(env[bootstrapMutationProbeEnvKey]);
    if (!probeScript) {
        return {
            status: 'unavailable',
            reason: plan.bootstrapMutationInterruptionProbe.unavailableReason,
        };
    }
    const probe = validateTauriPersonalHomeQaProbeResult(
        await runConfiguredQaProbe(probeScript, plan, { env }),
        'bootstrap-mutation-interruption',
    );
    await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env });
    await clickSelector(probe.operation === 'erase' ? plan.eraseSelector : plan.uninstallSelector, {
        appIdentifier: plan.appIdentifier,
        env,
    });
    if (probe.operation === 'erase') {
        await clickSelector(plan.eraseConfirmSelector, { appIdentifier: plan.appIdentifier, env });
    }
    if (!(await selectorPresent(plan.recoveryRetrySelector, {
        appIdentifier: plan.appIdentifier,
        env,
        timeoutMs: 30_000,
    }))) {
        throw new Error(`Explicit ${probe.operation} did not leave bootstrap blocked with deliberate Retry.`);
    }
    return { operation: probe.operation, status: 'verified' };
}

async function waitForDaemonRecovered(expectedMachineId, plan, { env = process.env } = {}) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const status = await runLoadedSystemTask('daemon.service.status.v1', plan, { env });
            if (status?.daemonRunning === true && readString(status?.machineId) === expectedMachineId) return status;
        } catch {
            // The service can be transiently unavailable while the production retry action starts it.
        }
        // eslint-disable-next-line no-await-in-loop
        await delay(1_000);
    }
    throw new Error('Personal Home daemon recovery did not restore the existing paired machine.');
}

async function waitForPersonalHomeUnavailable(canonicalServerUrl, { fetchImpl = fetch } = {}) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await fetchImpl(new URL('/health', canonicalServerUrl), { signal: AbortSignal.timeout(1_000) });
        } catch {
            return true;
        }
        // eslint-disable-next-line no-await-in-loop
        await delay(500);
    }
    throw new Error('Personal Home runtime remained reachable after safe uninstall.');
}

async function captureLoadedSurface(plan, { env } = {}) {
    const screenshotPath = join(plan.artifactRoot, '01-personal-home-ready.png');
    await runCli([
        'webview-screenshot', '--format', 'png', '--file-path', screenshotPath,
        '--app-identifier', plan.appIdentifier,
    ], { appIdentifier: plan.appIdentifier, env });
    for (const type of ['structure', 'accessibility']) {
        // eslint-disable-next-line no-await-in-loop
        const snapshot = await runCli([
            'webview-dom-snapshot', '--type', type, '--app-identifier', plan.appIdentifier,
        ], { appIdentifier: plan.appIdentifier, env });
        // eslint-disable-next-line no-await-in-loop
        await writeTextArtifact(join(plan.artifactRoot, `01-personal-home-ready.${type}.yml`), String(snapshot.stdout ?? ''));
    }
    return screenshotPath;
}

async function readBuildIdentity() {
    const [{ stdout: head }, { stdout: status }] = await Promise.all([
        execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }),
        execFileAsync('git', ['status', '--short'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }),
    ]);
    return {
        head: head.trim(),
        dirtyEntries: status.split(/\r?\n/u).filter(Boolean).length,
    };
}

export async function runTauriPersonalHomeQa({
    argv = process.argv.slice(2),
    env = process.env,
    relaunchApp,
} = {}) {
    let scenarioEnv = env;
    const plan = buildTauriPersonalHomeQaPlan({ env: scenarioEnv });
    const requireComplete = argv.includes('--require-complete');
    if (argv.includes('--help') || argv.includes('-h')) {
        process.stdout.write('Usage: node ./apps/ui/scripts/qa/tauriPersonalHomeMcpQa.mjs [--json] [--require-complete]\n');
        return;
    }
    if (argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify({ ok: true, plan }, null, 2)}\n`);
        return;
    }
    if (!plan.appIdentifier) {
        throw new Error('Personal Home loaded QA requires an exact Tauri app identifier.');
    }
    const freshBootstrapEvidence = {
        prelaunchFactsEmpty: readString(scenarioEnv.HAPPIER_TAURI_PERSONAL_HOME_QA_FRESH_PRELAUNCH_VERIFIED) === '1',
    };

    await ensureDir(plan.artifactRoot);
    await startForbiddenSurfaceObservation(plan, { env: scenarioEnv });
    const setupSurfaceObserved = await selectorPresent(plan.setupSelector, {
        appIdentifier: plan.appIdentifier,
        env: scenarioEnv,
        timeoutMs: 2_000,
    });
    const matchedShellSelector = await waitForAnyShell(plan, { env: scenarioEnv });
    const noOnboardingObservation = await finishForbiddenSurfaceObservation(plan, { env: scenarioEnv });

    await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    if (!(await selectorPresent(plan.personalHomeSettingsSelector, {
        appIdentifier: plan.appIdentifier,
        env: scenarioEnv,
        timeoutMs: 30_000,
    }))) {
        throw new Error('Canonical Personal Home settings projection did not load after bootstrap.');
    }

    const runtimeEvidenceBeforeRestart = await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv });
    const signupRefusalBeforeRestart = await verifyAnonymousSignupRefused({
        canonicalServerUrl: runtimeEvidenceBeforeRestart.canonicalServerUrl,
    });
    const marker = `lane03-loaded-${nowStamp()}`;
    const sessionEvidenceBeforeRestart = await verifyPersonalHomeSessionEvidence({
        agentId: readString(scenarioEnv.HAPPIER_TAURI_PERSONAL_HOME_QA_AGENT, 'codex'),
        marker,
        runCliJson: async (args) => await runPersonalHomeCliJson(args, { env: scenarioEnv }),
        sessionPath: readString(scenarioEnv.HAPPIER_TAURI_PERSONAL_HOME_QA_SESSION_PATH, repoRoot),
    });
    await ensureSessionVisible(sessionEvidenceBeforeRestart.sessionId, plan, { env: scenarioEnv });

    const appRelaunchEvidence = await verifyPersonalHomeAppRelaunch({
        env: scenarioEnv,
        relaunchApp: async ({ env: currentEnv }) => {
            const relaunched = await relaunchApp?.({ env: currentEnv });
            if (isRecord(relaunched?.env)) scenarioEnv = relaunched.env;
            return relaunched;
        },
        verifyAfterRelaunch: async () => {
            await waitForAnyShell(plan, { env: scenarioEnv });
            await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
            const profileAvailable = await selectorPresent(plan.personalHomeSettingsSelector, {
                appIdentifier: plan.appIdentifier,
                env: scenarioEnv,
                timeoutMs: 30_000,
            });
            await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv });
            await verifyAnonymousSignupRefused({ canonicalServerUrl: runtimeEvidenceBeforeRestart.canonicalServerUrl });
            const persistedSession = await verifyPersonalHomeSessionEvidence({
                marker,
                runCliJson: async (args) => await runPersonalHomeCliJson(args, { env: scenarioEnv }),
                sessionId: sessionEvidenceBeforeRestart.sessionId,
            });
            await ensureSessionVisible(sessionEvidenceBeforeRestart.sessionId, plan, { env: scenarioEnv });
            return {
                credentialAuthenticated: persistedSession.transcriptPersisted === true,
                profileAvailable,
                sessionMarkerPersisted: persistedSession.transcriptPersisted === true,
            };
        },
    });

    await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    await clickSelector('[data-testid="settings.personalHomeRuntime.restart"]', {
        appIdentifier: plan.appIdentifier,
        env: scenarioEnv,
    });
    const runtimeEvidenceAfterRestart = await waitForRestartedPersonalHomeEvidence({
        initialPid: runtimeEvidenceBeforeRestart.listener.pid,
        readEvidence: async () => await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv }),
    });
    const signupRefusalAfterRestart = await verifyAnonymousSignupRefused({
        canonicalServerUrl: runtimeEvidenceAfterRestart.canonicalServerUrl,
    });
    const sessionEvidenceAfterRestart = await verifyPersonalHomeSessionEvidence({
        marker,
        runCliJson: async (args) => await runPersonalHomeCliJson(args, { env: scenarioEnv }),
        sessionId: sessionEvidenceBeforeRestart.sessionId,
    });
    await ensureSessionVisible(sessionEvidenceBeforeRestart.sessionId, plan, { env: scenarioEnv });
    const daemonStatusBeforeFailure = await runLoadedSystemTask('daemon.service.status.v1', plan, { env: scenarioEnv });
    const pairedMachineId = readString(daemonStatusBeforeFailure?.machineId);
    if (!pairedMachineId) throw new Error('Loaded Personal Home daemon did not expose its paired machine identity.');
    await runLoadedSystemTask('daemon.service.stop.v1', plan, { env: scenarioEnv });
    if (!(await selectorPresent('[data-testid="transcript-chat-list"]', {
        appIdentifier: plan.appIdentifier,
        env: scenarioEnv,
        timeoutMs: 5_000,
    })) || !(await waitForAnyShell(plan, { env: scenarioEnv }))) {
        throw new Error('Normal daemon stop removed the usable Personal Home shell or session transcript.');
    }
    const daemonStatusAfterAutomaticRecovery = await waitForDaemonRecovered(pairedMachineId, plan, { env: scenarioEnv });
    const scopedDaemonFailureEvidence = await verifyConfiguredScopedDaemonFailure(plan, pairedMachineId, { env: scenarioEnv });

    await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    await clickSelector(plan.updateSelector, { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    const runtimeEvidenceAfterUpdate = await waitForRestartedPersonalHomeEvidence({
        initialPid: runtimeEvidenceAfterRestart.listener.pid,
        readEvidence: async () => await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv }),
    });
    const signupRefusalAfterUpdate = await verifyAnonymousSignupRefused({
        canonicalServerUrl: runtimeEvidenceAfterUpdate.canonicalServerUrl,
    });
    const preservationEvidenceBeforeUninstall = await inspectPersonalHomePreservationEvidence({ env: scenarioEnv });

    await clickSelector(plan.uninstallSelector, { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    await waitForPersonalHomeUnavailable(runtimeEvidenceAfterUpdate.canonicalServerUrl);
    const preservationEvidenceAfterUninstall = await inspectPersonalHomePreservationEvidence({ env: scenarioEnv });
    if (preservationEvidenceAfterUninstall.configSha256 !== preservationEvidenceBeforeUninstall.configSha256
        || preservationEvidenceAfterUninstall.masterSecretSha256 !== preservationEvidenceBeforeUninstall.masterSecretSha256
        || preservationEvidenceAfterUninstall.purpose !== 'personal-home') {
        throw new Error('Safe uninstall changed Personal Home configuration, master secret, or classification.');
    }
    if (!(await selectorPresent(plan.personalHomeSettingsSelector, {
        appIdentifier: plan.appIdentifier,
        env: scenarioEnv,
        timeoutMs: 30_000,
    }))) {
        throw new Error('Safe uninstall removed the canonical Personal Home profile projection.');
    }
    await clickSelector(plan.updateSelector, { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    const runtimeEvidenceAfterReinstall = await waitForRestartedPersonalHomeEvidence({
        initialPid: runtimeEvidenceAfterUpdate.listener.pid,
        readEvidence: async () => await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv }),
    });
    const signupRefusalAfterReinstall = await verifyAnonymousSignupRefused({
        canonicalServerUrl: runtimeEvidenceAfterReinstall.canonicalServerUrl,
    });
    const sessionEvidenceAfterReinstall = await verifyPersonalHomeSessionEvidence({
        marker,
        runCliJson: async (args) => await runPersonalHomeCliJson(args, { env: scenarioEnv }),
        sessionId: sessionEvidenceBeforeRestart.sessionId,
    });
    await ensureSessionVisible(sessionEvidenceBeforeRestart.sessionId, plan, { env: scenarioEnv });
    await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    const screenshotPath = await captureLoadedSurface(plan, { env: scenarioEnv });
    const bootstrapMutationInterruptionEvidence = await verifyConfiguredBootstrapMutationInterruption(plan, { env: scenarioEnv });
    const verificationStatus = derivePersonalHomeVerificationStatus({
        appRelaunchEvidence,
        bootstrapMutationInterruptionEvidence,
        freshBootstrapEvidence,
        noOnboardingObservation,
        scopedDaemonFailureEvidence,
    });
    const summary = {
        ok: true,
        appIdentifier: plan.appIdentifier,
        appRelaunchEvidence,
        bootstrapMutationInterruptionEvidence,
        build: await readBuildIdentity(),
        daemonAutomaticRecoveryEvidence: {
            daemonRunningAfterAutomaticRecovery: daemonStatusAfterAutomaticRecovery.daemonRunning === true,
            sameMachineId: readString(daemonStatusAfterAutomaticRecovery.machineId) === pairedMachineId,
        },
        matchedShellSelector,
        freshBootstrapEvidence,
        noOnboardingObservation,
        preservationEvidenceAfterUninstall,
        preservationEvidenceBeforeUninstall,
        runtimeEvidenceAfterRestart,
        runtimeEvidenceAfterReinstall,
        runtimeEvidenceAfterUpdate,
        runtimeEvidenceBeforeRestart,
        sessionEvidenceAfterRestart,
        sessionEvidenceAfterReinstall,
        sessionEvidenceBeforeRestart,
        screenshotPath,
        scopedDaemonFailureEvidence,
        setupSurfaceObserved,
        signupRefusalAfterRestart,
        signupRefusalAfterReinstall,
        signupRefusalAfterUpdate,
        signupRefusalBeforeRestart,
        verificationStatus,
    };
    await writeTextArtifact(join(plan.artifactRoot, '99-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    assertPersonalHomeQaCompleteVerification({ requireComplete, verificationStatus });
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot: plan.artifactRoot, verificationStatus }, null, 2)}\n`);
    return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runTauriPersonalHomeQa().catch((error) => {
        process.stderr.write(`[tauri-personal-home-qa] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exit(1);
    });
}
