#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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

function pathIsWithin(rootPath, candidatePath) {
    const pathFromRoot = relative(resolve(rootPath), resolve(candidatePath));
    return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

export async function inspectPersonalHomeBackupArchiveEvidence({ archivePath, dataDir }) {
    if (pathIsWithin(dataDir, archivePath)) {
        throw new Error('Personal Home loaded QA backup archive is inside the Home data root.');
    }
    const archive = await stat(archivePath);
    if (!archive.isFile() || archive.size <= 0) {
        throw new Error('Personal Home loaded QA backup archive is missing or empty.');
    }
    const [realArchivePath, realDataDir] = await Promise.all([realpath(archivePath), realpath(dataDir)]);
    if (pathIsWithin(realDataDir, realArchivePath)) {
        throw new Error('Personal Home loaded QA backup archive resolves inside the Home data root.');
    }
    return {
        archiveBytes: archive.size,
        archivePath,
        outsidePersonalHomeDataRoot: true,
    };
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
    const { dataDir } = resolveRuntimePaths(env);
    const userHome = readString(env.HOME ?? env.USERPROFILE, homedir());
    return {
        appIdentifier,
        artifactRoot: resolveArtifactRoot(env),
        backupArchivePath: join(userHome, 'happier-personal-home-qa-backups', 'loaded-personal-home.tar'),
        backupConfirmSelector: '[data-testid="web-modal-confirm"]',
        backupPromptConfirmSelector: '[data-testid="web-prompt-confirm"]',
        backupPromptInputSelector: '[data-testid="web-prompt-input"]',
        backupResultSelector: '[data-testid="settings.personalHomeRuntime.backupResult"]',
        backupSelector: '[data-testid="settings.personalHomeRuntime.backup"]',
        dataDir,
        forbiddenOnboardingSelector: '[data-testid="onboarding-wizard-welcome-auth"]',
        personalHomeSettingsSelector: '[data-testid="settings.personalHomeRuntime.identity"]',
        shellSelectors: [
            '[data-testid="desktop-sidebar-chrome"]',
            '[data-testid="desktop-collapsed-shell-chrome"]',
            '[data-testid="desktop-narrow-shell-chrome"]',
        ],
        setupSelector: '[data-testid="personal-home-bootstrap-phase"]',
        prerequisites: [
            'Run on a dedicated OS user or VM; the stable Personal Home service name is user-global.',
            'Use a unique stack-owned Tauri identifier and storage scope.',
            'Do not inject an existing stack server into the renderer; the Desktop bootstrap owner must select the local Home.',
        ],
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

async function fillPromptInput(selector, value, { appIdentifier, env } = {}) {
    const script = `(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
            return { ok: false, reason: 'missing_input' };
        }
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) return { ok: false, reason: 'missing_value_setter' };
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
    })()`;
    await runCli([
        'webview-execute-js', '--script', script, '--app-identifier', appIdentifier, '--json',
    ], { appIdentifier, env });
}

async function runPersonalHomeBackup(plan, { env } = {}) {
    if (pathIsWithin(plan.dataDir, plan.backupArchivePath)) {
        throw new Error('Refusing to place the loaded QA backup inside Personal Home data.');
    }
    await ensureDir(dirname(plan.backupArchivePath));
    const existingArchive = await stat(plan.backupArchivePath).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
    });
    if (existingArchive) {
        throw new Error(`Refusing to reuse an existing loaded QA backup archive: ${plan.backupArchivePath}`);
    }

    await clickSelector(plan.backupSelector, { appIdentifier: plan.appIdentifier, env });
    await clickSelector(plan.backupConfirmSelector, { appIdentifier: plan.appIdentifier, env });
    await runCli([
        'webview-wait-for', '--type', 'selector', '--strategy', 'css', '--value', plan.backupPromptInputSelector,
        '--timeout', '30000', '--app-identifier', plan.appIdentifier,
    ], { appIdentifier: plan.appIdentifier, env });
    await fillPromptInput(plan.backupPromptInputSelector, plan.backupArchivePath, {
        appIdentifier: plan.appIdentifier,
        env,
    });
    await clickSelector(plan.backupPromptConfirmSelector, { appIdentifier: plan.appIdentifier, env });
    if (!(await selectorPresent(plan.backupResultSelector, {
        appIdentifier: plan.appIdentifier,
        env,
        timeoutMs: 180_000,
    }))) {
        throw new Error('Personal Home backup did not publish the verified production result row.');
    }
    return await inspectPersonalHomeBackupArchiveEvidence({
        archivePath: plan.backupArchivePath,
        dataDir: plan.dataDir,
    });
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

async function main(argv = process.argv.slice(2)) {
    const plan = buildTauriPersonalHomeQaPlan({ env: process.env });
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
        env: process.env,
        timeoutMs: 2_000,
    });
    const matchedShellSelector = await waitForAnyShell(plan, { env: process.env });
    if (await selectorPresent(plan.forbiddenOnboardingSelector, {
        appIdentifier: plan.appIdentifier,
        env: process.env,
        timeoutMs: 750,
    })) {
        throw new Error('Retired pre-auth onboarding replaced the loaded Personal Home shell.');
    }

    await navigate('/settings/server', { appIdentifier: plan.appIdentifier, env: process.env });
    if (!(await selectorPresent(plan.personalHomeSettingsSelector, {
        appIdentifier: plan.appIdentifier,
        env: process.env,
        timeoutMs: 30_000,
    }))) {
        throw new Error('Canonical Personal Home settings projection did not load after bootstrap.');
    }

    const runtimeEvidenceBeforeRestart = await inspectPersonalHomeRuntimeEvidence({ env: process.env });
    await clickSelector('[data-testid="settings.personalHomeRuntime.restart"]', {
        appIdentifier: plan.appIdentifier,
        env: process.env,
    });
    const runtimeEvidenceAfterRestart = await waitForRestartedPersonalHomeEvidence({
        initialPid: runtimeEvidenceBeforeRestart.listener.pid,
        readEvidence: async () => await inspectPersonalHomeRuntimeEvidence({ env: process.env }),
    });
    const backupEvidence = await runPersonalHomeBackup(plan, { env: process.env });
    const screenshotPath = await captureLoadedSurface(plan, { env: process.env });
    const summary = {
        ok: true,
        appIdentifier: plan.appIdentifier,
        backupEvidence,
        build: await readBuildIdentity(),
        matchedShellSelector,
        runtimeEvidenceAfterRestart,
        runtimeEvidenceBeforeRestart,
        screenshotPath,
        setupSurfaceObserved,
    };
    await writeTextArtifact(join(plan.artifactRoot, '99-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot: plan.artifactRoot }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(`[tauri-personal-home-qa] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exit(1);
    });
}
