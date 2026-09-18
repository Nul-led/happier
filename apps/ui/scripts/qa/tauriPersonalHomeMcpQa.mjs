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
    readPersonalHomeStartupReadiness,
} from '@happier-dev/cli-common/firstPartyRuntime/personalHome/readiness';
import {
    createPersonalHomeRuntimeSpec,
} from '@happier-dev/cli-common/firstPartyRuntime/personalHome/runtimeSpec';
import { readPersonalHomeIdentityValueFromSqlite } from '@happier-dev/cli-common/firstPartyRuntime/personalHome/productionAdapters';
import { isHappierRuntimePathWithinRoot } from '@happier-dev/cli-common/happierRuntime';

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

function readPersonalHomeCliTaskData(payload, operation) {
    const result = isRecord(payload) && payload.kind === 'personal_home_task_result' && isRecord(payload.result)
        ? payload.result
        : null;
    if (result?.ok !== true || !isRecord(result.data)) {
        throw new Error(`Canonical Personal Home ${operation} did not return successful typed task facts.`);
    }
    return result.data;
}

function requireBackupManifest(data, operation, homeServerIdentityId) {
    const manifest = isRecord(data?.manifest) ? data.manifest : null;
    if (manifest?.format !== 'happier-personal-home-backup'
        || manifest?.version !== 1
        || readString(manifest?.homeServerIdentityId) !== homeServerIdentityId) {
        throw new Error(`Canonical Personal Home ${operation} did not preserve the expected Home identity.`);
    }
    return manifest;
}

/**
 * Runs the public CLI wrappers over Lane 07's canonical backup/verify/restore owner, then delegates
 * only the loaded app/runtime restart mechanics to the existing Tauri launcher. The callback must
 * return observations from the same production runtime, profile, configuration, and session paths;
 * this helper grants no operation or recovery authority of its own.
 */
export async function verifyPersonalHomeBackupRestoreRestart({
    backupPath,
    canonicalServerUrl,
    homeServerIdentityId,
    preservationBeforeRestore,
    restartLoadedAppAndRuntime,
    runCliJson = runPersonalHomeCliJson,
} = {}) {
    const expectedBackupPath = readString(backupPath);
    const expectedCanonicalServerUrl = readString(canonicalServerUrl);
    const expectedHomeServerIdentityId = readString(homeServerIdentityId);
    if (!expectedBackupPath || !isAbsolute(expectedBackupPath)
        || !expectedCanonicalServerUrl || !expectedHomeServerIdentityId
        || typeof runCliJson !== 'function' || typeof restartLoadedAppAndRuntime !== 'function') {
        throw new Error('Personal Home backup/restore QA requires an absolute external archive and real production boundaries.');
    }
    if (preservationBeforeRestore?.purpose !== 'personal-home'
        || !readString(preservationBeforeRestore?.configSha256)
        || !readString(preservationBeforeRestore?.masterSecretSha256)) {
        throw new Error('Personal Home backup/restore QA requires the retained pre-restore configuration and secret facts.');
    }

    const backup = readPersonalHomeCliTaskData(
        await runCliJson(['home', 'backup', '--output', expectedBackupPath]),
        'backup',
    );
    requireBackupManifest(backup, 'backup', expectedHomeServerIdentityId);
    const archiveSha256 = readString(backup.sha256);
    if (readString(backup.path) !== expectedBackupPath || !/^[a-f0-9]{64}$/iu.test(archiveSha256)) {
        throw new Error('Canonical Personal Home backup did not return the requested verified external archive.');
    }

    const verification = readPersonalHomeCliTaskData(
        await runCliJson(['home', 'verify-backup', expectedBackupPath]),
        'backup verification',
    );
    requireBackupManifest(verification, 'backup verification', expectedHomeServerIdentityId);
    if (verification.identityMatchesCurrentHome !== 'match') {
        throw new Error('Canonical Personal Home backup verification did not match the current Home identity.');
    }

    const restore = readPersonalHomeCliTaskData(
        await runCliJson(['home', 'restore', expectedBackupPath, '--yes']),
        'restore',
    );
    requireBackupManifest(restore, 'restore', expectedHomeServerIdentityId);
    if (restore.outcome !== 'restored') {
        throw new Error(`Canonical Personal Home restore did not complete (${readString(restore.outcome, 'unknown')}).`);
    }

    const restarted = await restartLoadedAppAndRuntime();
    const runtime = restarted?.runtimeEvidence;
    const preservation = restarted?.preservationEvidence;
    const session = restarted?.sessionEvidence;
    if (restarted?.appRelaunched !== true || restarted?.runtimeRestarted !== true
        || runtime?.healthy !== true || runtime?.anonymousSignupEnabled !== false
        || readString(runtime?.canonicalServerUrl) !== expectedCanonicalServerUrl
        || readString(runtime?.readiness?.homeServerIdentityId) !== expectedHomeServerIdentityId
        || preservation?.purpose !== 'personal-home'
        || readString(preservation?.configSha256) !== readString(preservationBeforeRestore.configSha256)
        || !Number.isFinite(preservation?.databaseBytes) || Number(preservation.databaseBytes) <= 0
        || readString(preservation?.masterSecretSha256) !== readString(preservationBeforeRestore.masterSecretSha256)
        || session?.transcriptPersisted !== true || !readString(session?.sessionId)) {
        throw new Error('Personal Home restore/restart did not retain canonical identity, configuration, data, and session facts.');
    }

    return {
        archivePath: expectedBackupPath,
        archiveSha256,
        appRelaunched: true,
        canonicalServerUrl: expectedCanonicalServerUrl,
        configRetained: true,
        dataAndSessionRetained: true,
        homeServerIdentityId: expectedHomeServerIdentityId,
        masterSecretRetained: true,
        runtimeRestarted: true,
        status: 'verified',
    };
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
    return { marker: normalizedMarker, sessionId, transcriptPersisted: true };
}

function requireLoopbackListener(host, port, canonicalServerUrl) {
    const runtimeSpec = createPersonalHomeRuntimeSpec({ canonicalServerUrl });
    const normalizedHost = readString(host).replace(/^\[|\]$/gu, '').toLowerCase();
    const parsedUrl = new URL(canonicalServerUrl);
    const expectedPort = Number(parsedUrl.port);
    if (normalizedHost !== runtimeSpec.bindAddress
        || parsedUrl.origin !== `http://127.0.0.1:${expectedPort}`
        || !Number.isInteger(port)
        || port !== expectedPort) {
        throw new Error('Personal Home startup receipt does not match its stable loopback origin.');
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
    const receiptPath = join(paths.dataDir, 'startup-receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const purpose = state?.purpose;
    const canonicalServerUrl = readString(purpose?.canonicalServerUrl);
    if (purpose?.kind !== 'personal-home' || !canonicalServerUrl) {
        throw new Error('Loaded runtime is not durably classified as Personal Home.');
    }
    if (managedEnv.HAPPIER_SERVER_HOST !== '127.0.0.1'
        || managedEnv.HAPPIER_CANONICAL_SERVER_URL !== canonicalServerUrl
        || managedEnv.PORT !== String(new URL(canonicalServerUrl).port)) {
        throw new Error('Loaded Personal Home managed environment does not match its stable loopback origin.');
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
    const receiptNonce = readString(receipt?.nonce);
    if (!receiptNonce || receiptNonce.length > 256) {
        throw new Error('Personal Home startup receipt nonce is missing or invalid.');
    }
    const authenticatedReadiness = await readPersonalHomeStartupReadiness({ path: receiptPath, timeoutMs: 0 })
        .catch(() => {
            throw new Error('Personal Home startup receipt did not contain canonical live authenticated readiness.');
        });
    if (authenticatedReadiness.teamsBootstrapStatus !== 'ready') {
        throw new Error('Personal Home startup receipt did not prove the H6 Teams bootstrap is ready.');
    }
    const canonicalIdentity = await readPersonalHomeIdentityValueFromSqlite(
        join(paths.dataDir, 'happier-server-light.sqlite'),
    );
    const listenerAddress = requireLoopbackListener(receipt?.host, Number(receipt?.port), canonicalServerUrl);
    const listenerPid = Number(receipt?.pid);
    if (!Number.isSafeInteger(listenerPid) || listenerPid <= 0) {
        throw new Error('Personal Home startup receipt did not identify the loaded server process.');
    }
    if (authenticatedReadiness.homeServerIdentityId !== canonicalIdentity.homeServerIdentityId) {
        throw new Error('Personal Home startup receipt did not authenticate the canonical Home identity.');
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
        receiptNoncePresent: true,
        receiptNonceSha256: createHash('sha256').update(receiptNonce).digest('hex'),
        readiness: authenticatedReadiness,
        storagePolicy: 'plaintext_only',
        version: readString(state?.version) || null,
    };
}

/**
 * The receipt PID is the identity of the live process that wrote the receipt, so a changed PID on
 * a healthy Home is the freshness proof every restart shares. The startup nonce lives in the
 * installed service definition, so only a re-rendered definition (install/update/reinstall) can
 * change it; `requireChangedReceiptNonce` states which of the two a call site is entitled to.
 */
export async function waitForRestartedPersonalHomeEvidence({
    initialPid,
    initialReceiptNonceSha256,
    requireChangedReceiptNonce = false,
    readEvidence = async () => await inspectPersonalHomeRuntimeEvidence(),
    wait = delay,
    pollDelayMs = 1_000,
    timeoutMs = 120_000,
} = {}) {
    let lastError = null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const evidence = await readEvidence();
            const receiptNonceSha256 = readString(evidence?.receiptNonceSha256);
            if (evidence?.healthy === true
                && evidence?.anonymousSignupEnabled === false
                && Number(evidence?.listener?.pid) > 0
                && Number(evidence.listener.pid) !== Number(initialPid)
                && receiptNonceSha256
                && (!requireChangedReceiptNonce
                    || receiptNonceSha256 !== readString(initialReceiptNonceSha256))) {
                return evidence;
            }
        } catch (error) {
            lastError = error;
        }
        // eslint-disable-next-line no-await-in-loop
        await wait(Math.min(pollDelayMs, Math.max(0, deadline - Date.now())));
    }
    const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
    throw new Error(`Personal Home did not return healthy with a new process after restart.${detail}`);
}

/**
 * Lane 03's destructive-arbitration and recovery gate, driven entirely through real production
 * owners: the canonical erase/uninstall operations, the checked-in bootstrap mutation-pause seam,
 * and the existing Retry action rendered by the bootstrap gate or the post-shell recovery strip.
 *
 * It proves that an explicit destructive operation invoked between two real durable bootstrap
 * mutations wins at the next mutation boundary, that bootstrap loses safely and stays blocked
 * instead of continuing automatically, and that a deliberate Retry recovers to a healthy Home
 * with signup closed.
 */
export async function verifyPersonalHomeDestructiveArbitrationRecovery({
    armMutationPause,
    clickRetry,
    enterErasedRecoveryState,
    readMutationPause,
    readRuntimeEvidence,
    releaseMutationPause,
    uninstallRuntime,
    verifySignupRefused,
    mutationKind = 'relay.runtime.installOrUpdate.v1',
    pauseOrdinal = 2,
    pauseTtlMs = 180_000,
    waitForRetryAction,
    wait = delay,
    pollDelayMs = 500,
    pauseTimeoutMs = 180_000,
    recoveryTimeoutMs = 240_000,
} = {}) {
    for (const [name, value] of Object.entries({
        armMutationPause,
        clickRetry,
        enterErasedRecoveryState,
        readMutationPause,
        readRuntimeEvidence,
        releaseMutationPause,
        uninstallRuntime,
        verifySignupRefused,
        waitForRetryAction,
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Personal Home destructive arbitration QA requires a real ${name} boundary.`);
        }
    }

    const erasedState = await enterErasedRecoveryState();
    if (erasedState?.erased !== true) {
        throw new Error('Personal Home destructive arbitration QA could not reach the explicit erased recovery state.');
    }
    const blockedRetrySelectorAfterErase = await waitForRetryAction();
    if (!readString(blockedRetrySelectorAfterErase)) {
        throw new Error('Explicit erase did not leave a deliberate Retry action in the loaded shell.');
    }

    const armed = await armMutationPause({ kind: mutationKind, ordinal: pauseOrdinal, ttlMs: pauseTtlMs });
    if (armed?.ok !== true
        || armed?.armed?.kind !== mutationKind
        || Number(armed?.armed?.ordinal) !== pauseOrdinal) {
        throw new Error('The checked-in bootstrap mutation pause did not arm at the requested durable mutation.');
    }

    await clickRetry(blockedRetrySelectorAfterErase);

    let held = null;
    const pauseDeadline = Date.now() + pauseTimeoutMs;
    while (Date.now() <= pauseDeadline) {
        // eslint-disable-next-line no-await-in-loop
        const observed = await readMutationPause();
        if (observed?.held?.kind === mutationKind && Number(observed.held.ordinal) === pauseOrdinal) {
            held = observed;
            break;
        }
        // eslint-disable-next-line no-await-in-loop
        await wait(pollDelayMs);
    }
    if (!held || Number(held.observedMutations) !== pauseOrdinal) {
        throw new Error('The real Personal Home bootstrap never paused between its two durable runtime mutations.');
    }

    const uninstall = await uninstallRuntime();
    if (uninstall?.ok !== true) {
        throw new Error(`The canonical uninstall operation could not run while bootstrap was paused: ${readString(uninstall?.reason, 'unknown')}`);
    }

    await releaseMutationPause();

    const blockedRetrySelectorAfterArbitration = await waitForRetryAction();
    if (!readString(blockedRetrySelectorAfterArbitration)) {
        throw new Error('Bootstrap continued past the competing uninstall instead of blocking for a deliberate Retry.');
    }
    const pauseAfterArbitration = await readMutationPause();
    if (pauseAfterArbitration?.armed != null || pauseAfterArbitration?.held != null) {
        throw new Error('The checked-in bootstrap mutation pause did not clear itself after the arbitration.');
    }

    await clickRetry(blockedRetrySelectorAfterArbitration);

    let recoveredRuntimeEvidence = null;
    let lastRecoveryError = null;
    const recoveryDeadline = Date.now() + recoveryTimeoutMs;
    while (Date.now() <= recoveryDeadline) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const evidence = await readRuntimeEvidence();
            if (evidence?.healthy === true && evidence?.anonymousSignupEnabled === false) {
                recoveredRuntimeEvidence = evidence;
                break;
            }
        } catch (error) {
            lastRecoveryError = error;
        }
        // eslint-disable-next-line no-await-in-loop
        await wait(pollDelayMs);
    }
    if (!recoveredRuntimeEvidence) {
        const detail = lastRecoveryError instanceof Error ? ` Last error: ${lastRecoveryError.message}` : '';
        throw new Error(`Deliberate Retry did not recover the Personal Home to its ready state.${detail}`);
    }
    const signupRefusalAfterRecovery = await verifySignupRefused(recoveredRuntimeEvidence.canonicalServerUrl);

    return {
        blockedAfterCompetingUninstall: true,
        blockedRetrySelectorAfterArbitration,
        blockedRetrySelectorAfterErase,
        observedDurableMutationsBeforePause: Number(held.observedMutations),
        pausedMutationKind: mutationKind,
        pausedMutationOrdinal: pauseOrdinal,
        recoveredRuntimeEvidence,
        signupRefusalAfterRecovery,
        status: 'verified',
        uninstallWonDuringPausedBootstrap: true,
    };
}

function resolveArtifactRoot(env = process.env) {
    const explicit = readString(env.HAPPIER_TAURI_QA_OUTDIR);
    if (explicit) return isAbsolute(explicit) ? explicit : join(repoRoot, explicit);
    return join(repoRoot, '.project', 'logs', 'lane-03-personal-home-qa', `tauri-personal-home-${nowStamp()}`);
}

export function buildTauriPersonalHomeQaPlan({ env = process.env } = {}) {
    const appIdentifier = readString(env.HAPPIER_TAURI_MCP_APP_IDENTIFIER ?? env.HAPPIER_STACK_TAURI_IDENTIFIER);
    const disposableHome = readString(
        env.HAPPIER_TAURI_PERSONAL_HOME_QA_HOME ?? env.HOME ?? env.USERPROFILE,
        homedir(),
    );
    const backupArchivePath = join(disposableHome, 'personal-home-qa-external-backups', 'personal-home-backup.tar');
    const runtimePaths = resolveRuntimePaths(env);
    if ([runtimePaths.installRoot, runtimePaths.configDir, runtimePaths.dataDir]
        .some((root) => isHappierRuntimePathWithinRoot(backupArchivePath, root))) {
        throw new Error('Personal Home loaded QA backup destination must be outside the managed runtime and data layout.');
    }
    return {
        appIdentifier,
        artifactRoot: resolveArtifactRoot(env),
        backupArchivePath,
        // The Personal Home bootstrap performs two durable managed-runtime mutations: the loopback
        // install and the signup-closure re-render. The destructive-arbitration journey pauses the
        // real bootstrap before the second one.
        bootstrapMutationKind: 'relay.runtime.installOrUpdate.v1',
        bootstrapMutationPauseOrdinal: 2,
        eraseChoiceSelector: '[data-testid="web-modal-button-1"]',
        eraseConfirmSelector: '[data-testid="web-modal-confirm"]',
        eraseSelector: '[data-testid="settings.personalHomeRuntime.eraseData"]',
        forbiddenOnboardingSelector: '[data-testid="onboarding-wizard-welcome-auth"]',
        personalHomeSettingsSelector: '[data-testid="settings.personalHomeRuntime.home"]',
        recoveryRetrySelector: '[data-testid="personal-home-recovery-retry"]',
        removeProfileConfirmSelector: '[data-testid="web-modal-confirm"]',
        removeProfileSelector: '[data-testid="settings.personalHomeRuntime.removeProfile"]',
        setupRetrySelector: '[data-testid="personal-home-bootstrap-retry"]',
        shellSelectors: [
            '[data-testid="desktop-sidebar-chrome"]',
            '[data-testid="desktop-collapsed-shell-chrome"]',
            '[data-testid="desktop-narrow-shell-chrome"]',
        ],
        setupSelector: '[data-testid="personal-home-bootstrap-phase"]',
        uninstallSelector: '[data-testid="settings.personalHomeRuntime.uninstallRuntime"]',
        updateSelector: '[data-testid="settings.localRelayRuntime.installOrUpdate"]',
        prerequisites: [
            'Run on a dedicated OS user or VM; the stable Personal Home service name is user-global.',
            'Use a unique stack-owned Tauri identifier and storage scope.',
            'Do not inject an existing stack server into the renderer; the Desktop bootstrap owner must select the local Home.',
            'The canonical launcher verifies empty Personal Home runtime facts before starting the app.',
            'The checked-in document-start observer must remain active until the real shell is ready.',
        ],
    };
}

function isRecord(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
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

async function invokeCheckedInMcpHook(name, args, plan, { env, timeoutMs = cliTimeoutMs } = {}) {
    const allowedHooks = new Set([
        'controlPersonalHomeBootstrapQaPause',
        'ensureHappierSessionVisible',
        'navigateHappierQaPath',
        'readPersonalHomeBootstrapQaObservation',
        'readPersonalHomeDaemonQaStatus',
        'stopPersonalHomeDaemonForQa',
        'uninstallPersonalHomeRuntimeForQa',
    ]);
    if (!allowedHooks.has(name)) throw new Error(`Unsupported checked-in MCP hook: ${name}`);
    const script = `(async () => {
        const hook = window.__MCP__?.[${JSON.stringify(name)}];
        if (typeof hook !== 'function') return { ok: false, reason: 'missing-checked-in-hook' };
        return await hook(...${JSON.stringify(args)});
    })()`;
    const result = await runCli([
        'webview-execute-js', '--script', script, '--app-identifier', plan.appIdentifier, '--json',
    ], { appIdentifier: plan.appIdentifier, env, timeoutMs });
    const payload = findJsonPayload(result.stdout);
    return isRecord(payload?.data) ? payload.data : payload;
}

async function readForbiddenSurfaceObservation(plan, { env } = {}) {
    const facts = await invokeCheckedInMcpHook('readPersonalHomeBootstrapQaObservation', [], plan, { env });
    if (facts?.installedAtDocumentStart !== true || facts?.seenForbiddenOnboarding !== false) {
        throw new Error(facts?.seenForbiddenOnboarding === true
            ? 'Retired pre-auth onboarding appeared during Personal Home bootstrap.'
            : 'Checked-in Personal Home observation was not installed at document start.');
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
    const result = await invokeCheckedInMcpHook('navigateHappierQaPath', [target], { appIdentifier }, { env });
    if (result?.ok !== true) throw new Error(`Checked-in QA navigation failed: ${readString(result?.reason, 'unknown')}`);
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

async function clickWhenPresent(selector, { appIdentifier, env, timeoutMs = 30_000 } = {}) {
    if (!(await selectorPresent(selector, { appIdentifier, env, timeoutMs }))) return false;
    await runCli([
        'webview-interact', '--action', 'click', '--selector', selector,
        '--app-identifier', appIdentifier,
    ], { appIdentifier, env });
    return true;
}

/**
 * The bootstrap gate renders the setup failure Retry while the shell is still gated; the
 * post-shell recovery strip renders the same canonical controller retry once the shell is
 * released. Both are real production actions, so QA accepts whichever the loaded app shows.
 */
async function waitForAnyRetryAction(plan, { env, timeoutMs = 120_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const selector of [plan.setupRetrySelector, plan.recoveryRetrySelector]) {
            // eslint-disable-next-line no-await-in-loop
            if (await selectorPresent(selector, { appIdentifier: plan.appIdentifier, env, timeoutMs: 1_000 })) {
                return selector;
            }
        }
        // eslint-disable-next-line no-await-in-loop
        await delay(500);
    }
    throw new Error('The loaded Personal Home surface never offered its deliberate Retry action.');
}

async function ensureSessionVisible(sessionId, plan, { env } = {}) {
    const result = await invokeCheckedInMcpHook(
        'ensureHappierSessionVisible', [sessionId, { forceRefresh: true }], plan, { env, timeoutMs: 120_000 },
    );
    if (result?.ok !== true) throw new Error('Checked-in session visibility boundary could not load the persisted session.');
    if (!(await selectorPresent('[data-testid="transcript-chat-list"]', {
        appIdentifier: plan.appIdentifier,
        env,
        timeoutMs: 30_000,
    }))) {
        throw new Error('The loaded Desktop shell did not render the real persisted session transcript.');
    }
}

async function runLoadedSystemTask(kind, plan, { env = process.env } = {}) {
    const hook = kind === 'daemon.service.status.v1'
        ? 'readPersonalHomeDaemonQaStatus'
        : kind === 'daemon.service.stop.v1'
            ? 'stopPersonalHomeDaemonForQa'
            : null;
    if (!hook) throw new Error(`Unsupported Personal Home daemon QA operation: ${kind}`);
    const result = await invokeCheckedInMcpHook(hook, [], plan, { env, timeoutMs: 180_000 });
    if (result?.ok !== true) {
        throw new Error(`Loaded system task ${kind} failed: ${readString(result?.error?.message ?? result?.reason, 'unknown')}`);
    }
    return result.data ?? {};
}

async function waitForDaemonRecovered(expectedMachineId, plan, { env = process.env } = {}) {
    const deadline = Date.now() + 120_000;
    while (Date.now() <= deadline) {
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
    const deadline = Date.now() + 60_000;
    while (Date.now() <= deadline) {
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
    if (argv.includes('--help') || argv.includes('-h')) {
        process.stdout.write('Usage: node ./apps/ui/scripts/qa/tauriPersonalHomeMcpQa.mjs [--json]\n');
        return;
    }
    if (argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify({ ok: true, plan }, null, 2)}\n`);
        return;
    }
    if (!plan.appIdentifier) {
        throw new Error('Personal Home loaded QA requires an exact Tauri app identifier.');
    }
    await ensureDir(plan.artifactRoot);
    const setupSurfaceObserved = await selectorPresent(plan.setupSelector, {
        appIdentifier: plan.appIdentifier,
        env: scenarioEnv,
        timeoutMs: 2_000,
    });
    const matchedShellSelector = await waitForAnyShell(plan, { env: scenarioEnv });
    const noOnboardingObservation = await readForbiddenSurfaceObservation(plan, { env: scenarioEnv });

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
        initialReceiptNonceSha256: runtimeEvidenceBeforeRestart.receiptNonceSha256,
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
    if (daemonStatusAfterAutomaticRecovery.daemonRunning !== true
        || readString(daemonStatusAfterAutomaticRecovery.machineId) !== pairedMachineId) {
        throw new Error('Personal Home daemon recovery did not restore the same paired machine identity.');
    }
    const daemonAutomaticRecoveryEvidence = {
        daemonRunningAfterAutomaticRecovery: true,
        sameMachineId: true,
        status: 'verified',
    };

    await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    await clickSelector(plan.updateSelector, { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    const runtimeEvidenceAfterUpdate = await waitForRestartedPersonalHomeEvidence({
        initialPid: runtimeEvidenceAfterRestart.listener.pid,
        initialReceiptNonceSha256: runtimeEvidenceAfterRestart.receiptNonceSha256,
        // Install/update re-renders the managed service definition, so its startup nonce must change.
        requireChangedReceiptNonce: true,
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
        initialReceiptNonceSha256: runtimeEvidenceAfterUpdate.receiptNonceSha256,
        requireChangedReceiptNonce: true,
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
    if (runtimeEvidenceAfterReinstall.readiness.homeServerIdentityId
        !== runtimeEvidenceAfterUpdate.readiness.homeServerIdentityId) {
        throw new Error('Personal Home reinstall changed the canonical Home identity.');
    }
    const runtimeLifecycleEvidence = {
        dataPreservedAcrossUninstall: preservationEvidenceAfterUninstall.configSha256 === preservationEvidenceBeforeUninstall.configSha256
            && preservationEvidenceAfterUninstall.masterSecretSha256 === preservationEvidenceBeforeUninstall.masterSecretSha256,
        homeIdentityPreservedAcrossReinstall: true,
        status: 'verified',
    };

    // Run Lane 07's safe consumed data-operation vertical before the final erase phase. The backup
    // destination is outside the managed runtime/data layout but remains inside the launcher's
    // disposable OS home, so the launcher retains ownership of eventual environment cleanup.
    await ensureDir(dirname(plan.backupArchivePath));
    const backupRestoreRestartEvidence = await verifyPersonalHomeBackupRestoreRestart({
        backupPath: plan.backupArchivePath,
        canonicalServerUrl: runtimeEvidenceAfterReinstall.canonicalServerUrl,
        homeServerIdentityId: runtimeEvidenceAfterReinstall.readiness.homeServerIdentityId,
        preservationBeforeRestore: await inspectPersonalHomePreservationEvidence({ env: scenarioEnv }),
        runCliJson: async (args) => await runPersonalHomeCliJson(args, { env: scenarioEnv }),
        restartLoadedAppAndRuntime: async () => {
            const runtimeEvidenceAfterRestore = await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv });
            const operationAppRelaunchEvidence = await verifyPersonalHomeAppRelaunch({
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
                    const runtime = await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv });
                    await verifyAnonymousSignupRefused({ canonicalServerUrl: runtime.canonicalServerUrl });
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
            const runtimeEvidence = await waitForRestartedPersonalHomeEvidence({
                initialPid: runtimeEvidenceAfterRestore.listener.pid,
                initialReceiptNonceSha256: runtimeEvidenceAfterRestore.receiptNonceSha256,
                readEvidence: async () => await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv }),
            });
            await verifyAnonymousSignupRefused({ canonicalServerUrl: runtimeEvidence.canonicalServerUrl });
            const sessionEvidence = await verifyPersonalHomeSessionEvidence({
                marker,
                runCliJson: async (args) => await runPersonalHomeCliJson(args, { env: scenarioEnv }),
                sessionId: sessionEvidenceBeforeRestart.sessionId,
            });
            await ensureSessionVisible(sessionEvidenceBeforeRestart.sessionId, plan, { env: scenarioEnv });
            return {
                appRelaunched: operationAppRelaunchEvidence.status === 'verified',
                preservationEvidence: await inspectPersonalHomePreservationEvidence({ env: scenarioEnv }),
                runtimeEvidence,
                runtimeRestarted: true,
                sessionEvidence,
            };
        },
    });
    await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
    const screenshotPath = await captureLoadedSurface(plan, { env: scenarioEnv });

    // Destructive arbitration and recovery run last: they intentionally destroy this Home's data
    // after every preservation, restart, session, and reinstall proof has been collected.
    const destructiveArbitrationEvidence = await verifyPersonalHomeDestructiveArbitrationRecovery({
        mutationKind: plan.bootstrapMutationKind,
        pauseOrdinal: plan.bootstrapMutationPauseOrdinal,
        enterErasedRecoveryState: async () => {
            await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
            // "Remove Home from Happier" drops the completed profile and this device's credential
            // while leaving runtime and data intact, so the erased runtime can reach the canonical
            // deliberate-Retry recovery state instead of being bypassed as already completed.
            await clickSelector(plan.removeProfileSelector, { appIdentifier: plan.appIdentifier, env: scenarioEnv });
            await clickWhenPresent(plan.removeProfileConfirmSelector, {
                appIdentifier: plan.appIdentifier,
                env: scenarioEnv,
            });
            await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: scenarioEnv });
            await clickSelector(plan.eraseSelector, { appIdentifier: plan.appIdentifier, env: scenarioEnv });
            await clickWhenPresent(plan.eraseChoiceSelector, { appIdentifier: plan.appIdentifier, env: scenarioEnv });
            await clickWhenPresent(plan.eraseConfirmSelector, { appIdentifier: plan.appIdentifier, env: scenarioEnv });
            await waitForPersonalHomeUnavailable(runtimeEvidenceAfterReinstall.canonicalServerUrl);
            return { erased: true };
        },
        waitForRetryAction: async () => await waitForAnyRetryAction(plan, { env: scenarioEnv }),
        clickRetry: async (selector) => await clickSelector(selector, {
            appIdentifier: plan.appIdentifier,
            env: scenarioEnv,
        }),
        armMutationPause: async (request) => await invokeCheckedInMcpHook(
            'controlPersonalHomeBootstrapQaPause', [{ action: 'arm', ...request }], plan, { env: scenarioEnv },
        ),
        readMutationPause: async () => await invokeCheckedInMcpHook(
            'controlPersonalHomeBootstrapQaPause', [{ action: 'read' }], plan, { env: scenarioEnv },
        ),
        releaseMutationPause: async () => await invokeCheckedInMcpHook(
            'controlPersonalHomeBootstrapQaPause', [{ action: 'release' }], plan, { env: scenarioEnv },
        ),
        uninstallRuntime: async () => await invokeCheckedInMcpHook(
            'uninstallPersonalHomeRuntimeForQa', [], plan, { env: scenarioEnv, timeoutMs: 180_000 },
        ),
        readRuntimeEvidence: async () => await inspectPersonalHomeRuntimeEvidence({ env: scenarioEnv }),
        verifySignupRefused: async (canonicalServerUrl) => await verifyAnonymousSignupRefused({ canonicalServerUrl }),
    });
    await waitForAnyShell(plan, { env: scenarioEnv });

    const summary = {
        ok: true,
        appIdentifier: plan.appIdentifier,
        appRelaunchEvidence,
        backupRestoreRestartEvidence,
        build: await readBuildIdentity(),
        daemonAutomaticRecoveryEvidence,
        destructiveArbitrationEvidence,
        matchedShellSelector,
        noOnboardingObservation,
        preservationEvidenceAfterUninstall,
        preservationEvidenceBeforeUninstall,
        runtimeEvidenceAfterRestart,
        runtimeEvidenceAfterReinstall,
        runtimeEvidenceAfterUpdate,
        runtimeEvidenceBeforeRestart,
        runtimeLifecycleEvidence,
        sessionEvidenceAfterRestart,
        sessionEvidenceAfterReinstall,
        sessionEvidenceBeforeRestart,
        screenshotPath,
        setupSurfaceObserved,
        signupRefusalAfterRestart,
        signupRefusalAfterReinstall,
        signupRefusalAfterUpdate,
        signupRefusalBeforeRestart,
    };
    await writeTextArtifact(join(plan.artifactRoot, '99-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot: plan.artifactRoot }, null, 2)}\n`);
    return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runTauriPersonalHomeQa().catch((error) => {
        process.stderr.write(`[tauri-personal-home-qa] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exit(1);
    });
}
