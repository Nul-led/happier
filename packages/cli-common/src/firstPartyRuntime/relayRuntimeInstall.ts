import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, win32 as win32Path } from 'node:path';

import {
    applyServicePlan,
    buildServiceDefinition,
    planServiceAction,
    resolveServiceBackend,
    type ServiceBackend,
    type ServiceSpec,
} from '../service/index.js';

import { checkRelayRuntimeHealth, resolveRelayRuntimeDefaults } from './relayRuntime.js';
import { removeRuntimePayloadPath } from './copyRuntimePayloadTree.js';
import {
    mergeSelfHostServerEnvText,
    parseEnvText,
    renderSelfHostServerEnvText,
    resolveSelfHostServerMigrationPlan,
    resolveConfiguredSelfHostBaseUrl,
} from './selfHostServerEnv.js';
import {
    relocateServerRuntimeArtifactClosure,
    resolveServerRuntimePayloadRootFromBinaryPath,
} from './serverRuntimeArtifactLayout.js';
import { copyDirectoryTreePreservingSymlinks } from './copyDirectoryTreePreservingSymlinks.js';
import { resolveNonCollidingRelayPort } from './resolveNonCollidingRelayPort.js';
import { computeUiDeploymentDigest, resolveUiDeploymentIdentity } from './uiDeploymentIdentity.js';
import { isPidPresent } from '../process/processLiveness.js';
import {
    assertPersonalHomeEnvironmentKeys,
    createPersonalHomeRuntimeSpec,
    renderPersonalHomeRuntimeEnv,
    type ManagedRelayPurpose,
} from './personalHome/personalHomeRuntimeSpec.js';
import { withPersonalHomeOperationLock } from './personalHome/lock.js';
import { resolvePersonalHomeRuntimeLayout } from './personalHome/layout.js';
import { assertPersonalHomeRelocationAllowsActivation } from './personalHome/relocation.js';
import type { PersonalHomeRestorePoint } from './personalHome/restorePoint.js';
import type { PersonalHomeRestoreHooks } from './personalHome/restore.js';
import { readEffectivePersonalHomeSignupPolicy } from './personalHomeSignupPolicy.js';
import { withFirstPartyPayloadMutationLock } from './withFirstPartyPayloadMutationLock.js';

const RELAY_RUNTIME_MANAGED_ROOT_ENTRIES = Object.freeze([
    'bin',
    'ui-web',
] as const);
const DEFAULT_RELAY_RUNTIME_INSTALL_HEALTHCHECK_TIMEOUT_MS = 120_000;
const MAX_RELAY_RUNTIME_INSTALL_HEALTHCHECK_TIMEOUT_MS = 600_000;
const RELAY_RUNTIME_STARTUP_RECEIPT_WAIT_MS = 10_000;
const RELAY_RUNTIME_STARTUP_RECEIPT_POLL_MS = 100;
const SERVER_STARTUP_RECEIPT_PATH_ENV = 'HAPPIER_SERVER_STARTUP_RECEIPT_PATH';
const SERVER_STARTUP_RECEIPT_NONCE_ENV = 'HAPPIER_SERVER_STARTUP_RECEIPT_NONCE';
const MANAGED_RELAY_PURPOSE_ENV = 'HAPPIER_MANAGED_RELAY_PURPOSE';

export type RelayRuntimeInstallRollbackFailure = Readonly<{
    phase: 'candidate_stop' | 'runtime_restore' | 'personal_home_restore' | 'service_restore' | 'install_root_restore' | 'artifact_disposal';
    error: unknown;
}>;

export class RelayRuntimeInstallRollbackIncompleteError extends Error {
    readonly code = 'RELAY_RUNTIME_INSTALL_ROLLBACK_INCOMPLETE' as const;

    constructor(
        readonly originalError: unknown,
        readonly rollbackFailures: readonly RelayRuntimeInstallRollbackFailure[],
        readonly recoveryArtifacts: Readonly<{
            runtimeBackupRoot?: string;
            personalHomeRestorePointPath?: string;
            personalHomeRestoreRollbackPaths?: readonly string[];
        }>,
    ) {
        super('[relay-runtime] candidate activation failed and rollback could not be completed; recovery artifacts were preserved', {
            cause: new AggregateError(
                [originalError, ...rollbackFailures.map((failure) => failure.error)],
                'Relay runtime install and rollback failures',
            ),
        });
        this.name = 'RelayRuntimeInstallRollbackIncompleteError';
    }
}

type RelayRuntimeInstallRootMigration = Readonly<{
    platform: NodeJS.Platform;
    backend?: ServiceBackend;
    homeDir?: string;
    migratedInstallRoot: string;
    originalInstallRoot: string;
    runServiceCommands?: boolean;
    serverBinaryName: string;
    serviceName?: string;
    shimPath: string;
    stdoutPath?: string;
    stderrPath?: string;
}>;

type RelayRuntimeInstallRootMigrationSource = Readonly<{
    kind: 'owned-current-lane' | 'legacy-unsuffixed';
    sourceInstallRoot: string;
}>;

function tryParseJsonObject(text: string): Record<string, unknown> | null {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function normalizeComparablePathKey(value: string | null | undefined): string | null {
    const trimmed = String(value ?? '').trim().replace(/[\\/]+$/, '');
    return trimmed || null;
}

function parseSystemdUnitWorkingDirectory(unitText: string): string | null {
    const lines = String(unitText ?? '').split(/\r?\n/u);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
        if (!trimmed.toLowerCase().startsWith('workingdirectory=')) continue;
        const value = trimmed.slice('WorkingDirectory='.length).trim();
        return value || null;
    }
    return null;
}

function xmlUnescape(value: string): string {
    return String(value ?? '')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&gt;', '>')
        .replaceAll('&lt;', '<')
        .replaceAll('&amp;', '&');
}

function parseLaunchdPlistWorkingDirectory(plistText: string): string | null {
    const match = String(plistText ?? '').match(/<key>\s*WorkingDirectory\s*<\/key>\s*<string>([\s\S]*?)<\/string>/iu);
    const value = match?.[1]?.trim();
    return value ? xmlUnescape(value) : null;
}

function parseServiceDefinitionWorkingDirectory(params: Readonly<{
    backend: 'systemd-user' | 'systemd-system' | 'launchd-user' | 'launchd-system';
    definitionText: string;
}>): string | null {
    if (params.backend === 'systemd-user' || params.backend === 'systemd-system') {
        return parseSystemdUnitWorkingDirectory(params.definitionText);
    }
    if (params.backend === 'launchd-user' || params.backend === 'launchd-system') {
        return parseLaunchdPlistWorkingDirectory(params.definitionText);
    }
    return null;
}

function relayRuntimeStateMatchesRequestedLane(params: Readonly<{
    state: Record<string, unknown>;
    channel: 'preview' | 'publicdev';
    mode: 'user' | 'system';
}>): boolean {
    const stateChannel = String(params.state.channel ?? '').trim();
    const stateMode = String(params.state.mode ?? '').trim();
    const channelMatches = stateChannel === params.channel
        || (params.channel === 'publicdev' && stateChannel === 'dev');
    const modeMatches = !stateMode || stateMode === params.mode;
    return channelMatches && modeMatches;
}

export async function shouldMigrateLegacyUnsuffixedRelayRuntimeInstallRoot(params: Readonly<{
    platform: NodeJS.Platform;
    mode: 'user' | 'system';
    channel: 'stable' | 'preview' | 'publicdev';
    homeDir: string;
}>): Promise<boolean> {
    if (params.mode !== 'user') return false;
    if (params.channel === 'stable') return false;

    const defaults = resolveRelayRuntimeDefaults({
        platform: params.platform,
        mode: params.mode,
        channel: params.channel,
        homeDir: params.homeDir,
    });
    if (existsSync(defaults.installRoot)) return false;

    const legacyDefaults = resolveRelayRuntimeDefaults({
        platform: params.platform,
        mode: params.mode,
        channel: 'stable',
        homeDir: params.homeDir,
    });
    if (!existsSync(legacyDefaults.installRoot)) return false;

    const legacyStatePath = join(legacyDefaults.installRoot, 'self-host-state.json');
    if (!existsSync(legacyStatePath)) return true;

    const legacyStateText = await readFile(legacyStatePath, 'utf8').catch(() => '');
    const legacyState = tryParseJsonObject(legacyStateText);
    return Boolean(legacyState && relayRuntimeStateMatchesRequestedLane({
        state: legacyState,
        channel: params.channel,
        mode: params.mode,
    }));
}

async function resolveOwnedCurrentLaneRelayRuntimeInstallRootMigrationSource(params: Readonly<{
    platform: NodeJS.Platform;
    mode: 'user' | 'system';
    channel: 'stable' | 'preview' | 'publicdev';
    homeDir: string;
}>): Promise<string | null> {
    if (params.mode !== 'user' || params.channel === 'stable') return null;

    const defaults = resolveRelayRuntimeDefaults(params);
    if (existsSync(defaults.installRoot)) return null;

    const backend: ServiceBackend = resolveServiceBackend({
        platform: params.platform,
        mode: params.mode,
    });
    if (backend !== 'systemd-user' && backend !== 'launchd-user') return null;

    const serverBinaryName = params.platform === 'win32' ? 'happier-server.exe' : 'happier-server';
    const serviceDefinition = buildServiceDefinition({
        backend,
        homeDir: params.homeDir,
        spec: buildRelayRuntimeServiceSpec({
            serviceName: defaults.serviceName,
            installRoot: defaults.installRoot,
            serverBinaryPath: join(defaults.installRoot, 'bin', serverBinaryName),
            env: {},
            stdoutPath: join(defaults.logDir, 'server.out.log'),
            stderrPath: join(defaults.logDir, 'server.err.log'),
        }),
    });
    if (!existsSync(serviceDefinition.path)) return null;

    const definitionText = await readFile(serviceDefinition.path, 'utf8').catch(() => '');
    const ownedInstallRoot = definitionText.trim()
        ? normalizeComparablePathKey(parseServiceDefinitionWorkingDirectory({ backend, definitionText }))
        : null;
    const canonicalInstallRoot = normalizeComparablePathKey(defaults.installRoot);
    if (!ownedInstallRoot || !canonicalInstallRoot || ownedInstallRoot === canonicalInstallRoot) return null;
    return existsSync(ownedInstallRoot) ? ownedInstallRoot : null;
}

async function resolveRelayRuntimeInstallRootMigrationSource(params: Readonly<{
    platform: NodeJS.Platform;
    mode: 'user' | 'system';
    channel: 'stable' | 'preview' | 'publicdev';
    homeDir: string;
}>): Promise<RelayRuntimeInstallRootMigrationSource | null> {
    const ownedInstallRoot = await resolveOwnedCurrentLaneRelayRuntimeInstallRootMigrationSource(params);
    if (ownedInstallRoot) {
        return { kind: 'owned-current-lane', sourceInstallRoot: ownedInstallRoot };
    }
    if (!(await shouldMigrateLegacyUnsuffixedRelayRuntimeInstallRoot(params))) return null;
    return {
        kind: 'legacy-unsuffixed',
        sourceInstallRoot: resolveRelayRuntimeDefaults({ ...params, channel: 'stable' }).installRoot,
    };
}

async function resolvePersonalHomeRuntimeDataDirForInstallRoot(params: Readonly<{
    platform: NodeJS.Platform;
    mode: 'user' | 'system';
    channel: 'stable' | 'preview' | 'publicdev';
    homeDir: string;
    installRoot: string;
}>): Promise<string> {
    const defaults = resolveRelayRuntimeDefaults(params);
    const configDir = params.mode === 'user' ? join(params.installRoot, 'config') : defaults.configDir;
    const logsDir = params.mode === 'user' ? join(params.installRoot, 'logs') : defaults.logDir;
    const envPath = join(configDir, 'server.env');
    const envText = existsSync(envPath) ? await readFile(envPath, 'utf8').catch(() => '') : '';
    const persistedEnv = parseEnvText(envText);
    return resolvePersonalHomeRuntimeLayout({
        env: {
            ...persistedEnv,
            HAPPIER_SELF_HOST_INSTALL_ROOT: params.installRoot,
            HAPPIER_SELF_HOST_CONFIG_DIR: configDir,
            HAPPIER_SELF_HOST_LOG_DIR: logsDir,
            ...(
                persistedEnv.HAPPIER_SERVER_LIGHT_DATA_DIR || persistedEnv.HAPPY_SERVER_LIGHT_DATA_DIR
                    ? {}
                    : { HAPPIER_SERVER_LIGHT_DATA_DIR: params.mode === 'user' ? join(params.installRoot, 'data') : defaults.dataDir }
            ),
        },
        homeDir: params.homeDir,
        platform: params.platform,
        mode: params.mode,
        channel: params.channel,
    }).dataDir;
}

async function migrateOwnedCurrentLaneRelayRuntimeInstallRootIfNeeded(params: Readonly<{
    platform: NodeJS.Platform;
    mode: 'user' | 'system';
    channel: 'stable' | 'preview' | 'publicdev';
    homeDir: string;
    runServiceCommands: boolean;
    sourceInstallRoot?: string;
    assertPersonalHomeStopped?: () => Promise<void>;
}>): Promise<RelayRuntimeInstallRootMigration | null> {
    const defaults = resolveRelayRuntimeDefaults({
        platform: params.platform,
        mode: params.mode,
        channel: params.channel,
        homeDir: params.homeDir,
    });
    if (existsSync(defaults.installRoot)) return null;
    const ownedInstallRootKey = normalizeComparablePathKey(
        params.sourceInstallRoot
        ?? await resolveOwnedCurrentLaneRelayRuntimeInstallRootMigrationSource(params),
    );
    if (!ownedInstallRootKey || !existsSync(ownedInstallRootKey)) return null;
    const backend = resolveServiceBackend({ platform: params.platform, mode: params.mode });
    if (backend !== 'systemd-user' && backend !== 'launchd-user') return null;
    const serverBinaryName = params.platform === 'win32' ? 'happier-server.exe' : 'happier-server';
    if (params.assertPersonalHomeStopped) {
        if (params.runServiceCommands) {
            const stopSpec = buildRelayRuntimeServiceSpec({
                serviceName: defaults.serviceName,
                installRoot: ownedInstallRootKey,
                serverBinaryPath: join(ownedInstallRootKey, 'bin', serverBinaryName),
                env: {},
                stdoutPath: join(ownedInstallRootKey, 'logs', 'server.out.log'),
                stderrPath: join(ownedInstallRootKey, 'logs', 'server.err.log'),
            });
            const stopDefinition = buildServiceDefinition({ backend, homeDir: params.homeDir, spec: stopSpec });
            const stopPlan = planServiceAction({
                backend,
                action: 'stop',
                label: stopSpec.label,
                definitionPath: stopDefinition.path,
                persistent: true,
            });
            await applyServicePlan(stopPlan, { runCommands: true }).catch(() => undefined);
        }
        await params.assertPersonalHomeStopped();
    }

    await mkdir(dirname(defaults.installRoot), { recursive: true });
    await rename(ownedInstallRootKey, defaults.installRoot);

    return {
        platform: params.platform,
        migratedInstallRoot: defaults.installRoot,
        originalInstallRoot: ownedInstallRootKey,
        serverBinaryName,
        shimPath: join(defaults.binDir, serverBinaryName),
    };
}

async function migrateLegacyUnsuffixedRelayRuntimeInstallRootIfNeeded(params: Readonly<{
    platform: NodeJS.Platform;
    mode: 'user' | 'system';
    channel: 'stable' | 'preview' | 'publicdev';
    homeDir: string;
    runServiceCommands: boolean;
    sourceInstallRoot?: string;
    assertPersonalHomeStopped?: () => Promise<void>;
}>): Promise<RelayRuntimeInstallRootMigration | null> {
    const defaults = resolveRelayRuntimeDefaults({
        platform: params.platform,
        mode: params.mode,
        channel: params.channel,
        homeDir: params.homeDir,
    });
    if (existsSync(defaults.installRoot)) return null;

    const legacyDefaults = resolveRelayRuntimeDefaults({
        platform: params.platform,
        mode: params.mode,
        channel: 'stable',
        homeDir: params.homeDir,
    });
    const sourceInstallRoot = normalizeComparablePathKey(params.sourceInstallRoot ?? legacyDefaults.installRoot);
    if (!sourceInstallRoot || !existsSync(sourceInstallRoot)) return null;

    if (params.runServiceCommands) {
        const backend: ServiceBackend = resolveServiceBackend({
            platform: params.platform,
            mode: params.mode,
        });
        const serverBinaryPath = join(
            legacyDefaults.installRoot,
            'bin',
            params.platform === 'win32' ? 'happier-server.exe' : 'happier-server',
        );
        const stdoutPath = join(legacyDefaults.logDir, 'server.out.log');
        const stderrPath = join(legacyDefaults.logDir, 'server.err.log');

        const serviceNamesToStop = new Set([legacyDefaults.serviceName, defaults.serviceName]);
        for (const serviceName of serviceNamesToStop) {
            const spec = buildRelayRuntimeServiceSpec({
                serviceName,
                installRoot: legacyDefaults.installRoot,
                serverBinaryPath,
                env: {},
                stdoutPath,
                stderrPath,
            });
            const definition = buildServiceDefinition({
                backend,
                homeDir: params.homeDir,
                spec,
            });
            const stopPlan = planServiceAction({
                backend,
                action: 'stop',
                label: spec.label,
                definitionPath: definition.path,
                persistent: true,
            });
            await applyServicePlan(stopPlan, { runCommands: true }).catch(() => undefined);
        }
    }
    await params.assertPersonalHomeStopped?.();

    await mkdir(dirname(defaults.installRoot), { recursive: true });
    await rename(sourceInstallRoot, defaults.installRoot);
    if (params.runServiceCommands) {
        const backend: ServiceBackend = resolveServiceBackend({
            platform: params.platform,
            mode: params.mode,
        });
        const serverBinaryPath = join(
            legacyDefaults.installRoot,
            'bin',
            params.platform === 'win32' ? 'happier-server.exe' : 'happier-server',
        );
        const legacyServiceSpec = buildRelayRuntimeServiceSpec({
            serviceName: legacyDefaults.serviceName,
            installRoot: legacyDefaults.installRoot,
            serverBinaryPath,
            env: {},
            stdoutPath: join(legacyDefaults.logDir, 'server.out.log'),
            stderrPath: join(legacyDefaults.logDir, 'server.err.log'),
        });
        const legacyServiceDefinition = buildServiceDefinition({
            backend,
            homeDir: params.homeDir,
            spec: legacyServiceSpec,
        });
        const uninstallLegacyPlan = planServiceAction({
            backend,
            action: 'uninstall',
            label: legacyServiceSpec.label,
            definitionPath: legacyServiceDefinition.path,
            persistent: true,
        });
        await applyServicePlan(uninstallLegacyPlan, { runCommands: true }).catch(() => undefined);
        await rm(legacyServiceDefinition.path, { force: true }).catch(() => undefined);
    }
    const serverBinaryName = params.platform === 'win32' ? 'happier-server.exe' : 'happier-server';
    return {
        platform: params.platform,
        backend: resolveServiceBackend({
            platform: params.platform,
            mode: params.mode,
        }),
        homeDir: params.homeDir,
        migratedInstallRoot: defaults.installRoot,
        originalInstallRoot: sourceInstallRoot,
        runServiceCommands: params.runServiceCommands !== false,
        serverBinaryName,
        serviceName: legacyDefaults.serviceName,
        shimPath: join(defaults.binDir, serverBinaryName),
        stdoutPath: join(legacyDefaults.logDir, 'server.out.log'),
        stderrPath: join(legacyDefaults.logDir, 'server.err.log'),
    };
}

async function rollbackRelayRuntimeInstallRootMigration(
    migration: RelayRuntimeInstallRootMigration,
): Promise<void> {
    if (!existsSync(migration.migratedInstallRoot)) return;
    if (existsSync(migration.originalInstallRoot)) return;

    await mkdir(dirname(migration.originalInstallRoot), { recursive: true });
    await rename(migration.migratedInstallRoot, migration.originalInstallRoot);

    const restoredServerBinaryPath = join(migration.originalInstallRoot, 'bin', migration.serverBinaryName);
    const hasRestoredServerBinary = existsSync(restoredServerBinaryPath);
    if (hasRestoredServerBinary) {
        await installBinaryShim({
            platform: migration.platform,
            sourcePath: restoredServerBinaryPath,
            destPath: migration.shimPath,
        });
    }

    if (
        migration.runServiceCommands
        && hasRestoredServerBinary
        && migration.backend
        && migration.homeDir
        && migration.serviceName
        && migration.stdoutPath
        && migration.stderrPath
    ) {
        const restoreServiceSpec = buildRelayRuntimeServiceSpec({
            serviceName: migration.serviceName,
            installRoot: migration.originalInstallRoot,
            serverBinaryPath: restoredServerBinaryPath,
            env: {},
            stdoutPath: migration.stdoutPath,
            stderrPath: migration.stderrPath,
        });
        const restoreServiceDefinition = buildServiceDefinition({
            backend: migration.backend,
            homeDir: migration.homeDir,
            spec: restoreServiceSpec,
        });
        const restoreServicePlan = planServiceAction({
            backend: migration.backend,
            action: 'install',
            label: restoreServiceSpec.label,
            definitionPath: restoreServiceDefinition.path,
            definitionContents: restoreServiceDefinition.contents,
            persistent: true,
        });
        await applyServicePlan(restoreServicePlan, { runCommands: true }).catch(() => undefined);
    }
}

async function copyDirectoryContents(params: Readonly<{
    sourceDir: string;
    destDir: string;
}>): Promise<void> {
    // Some payload roots are symlinked (for example `current -> versions/x.y.z`).
    // The staging destination directory is created via `mkdtemp(...)` and already exists, so we must
    // dereference the root symlink and copy the resolved directory contents into the existing folder.
    const resolvedSourceDir = await realpath(params.sourceDir).catch(() => params.sourceDir);
    await copyDirectoryTreePreservingSymlinks({
        sourceDir: resolvedSourceDir,
        destinationDir: params.destDir,
        shouldSkipRelativePath: (relativePath) => relativePath.split(/[\\/]/u).some((segment) => segment.startsWith('._')),
    });
}

function assertRootIfRequired(params: Readonly<{ platform: NodeJS.Platform; mode: 'user' | 'system' }>): void {
    if (params.mode !== 'system') return;
    if (params.platform === 'win32') return;
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid !== 0) {
        throw new Error('[relay-runtime] system install requires root privileges');
    }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function waitForRelayRuntimeStartupReceipt(params: Readonly<{
    path: string;
    nonce: string;
}>): Promise<Readonly<{ nonce: string; pid: number; host: string; port: number }>> {
    const deadline = Date.now() + RELAY_RUNTIME_STARTUP_RECEIPT_WAIT_MS;
    while (Date.now() <= deadline) {
        const receipt = await readFile(params.path, 'utf8')
            .then(tryParseJsonObject)
            .catch(() => null);
        const nonce = typeof receipt?.nonce === 'string' ? receipt.nonce : '';
        const pid = typeof receipt?.pid === 'number' && Number.isSafeInteger(receipt.pid)
            ? receipt.pid
            : 0;
        const rawHost = typeof receipt?.host === 'string' ? receipt.host.trim().toLowerCase() : '';
        const host = rawHost.startsWith('::ffff:') ? rawHost.slice('::ffff:'.length) : rawHost;
        const port = typeof receipt?.port === 'number' && Number.isInteger(receipt.port)
            ? receipt.port
            : 0;
        if (nonce === params.nonce && pid > 0 && isPidPresent(pid) && host && port >= 1 && port <= 65535) {
            return { nonce, pid, host, port };
        }
        await new Promise<void>((resolve) => setTimeout(resolve, RELAY_RUNTIME_STARTUP_RECEIPT_POLL_MS));
    }
    throw new Error('[relay-runtime] relay runtime startup attestation did not arrive');
}

async function probePortOpen(params: Readonly<{ host: string; port: number; timeoutMs: number }>): Promise<boolean> {
    return await new Promise((resolve) => {
        const socket = createConnection({
            host: params.host,
            port: params.port,
        });
        const finish = (value: boolean): void => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(params.timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

async function fetchJson(params: Readonly<{ url: string; timeoutMs: number }>): Promise<{
    ok: boolean;
    status: number;
    body: unknown;
}> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
        const response = await fetch(params.url, {
            signal: controller.signal,
            headers: {
                accept: 'application/json',
            },
        });
        return {
            ok: response.ok,
            status: response.status,
            body: await response.json().catch(() => ({})),
        };
    } finally {
        clearTimeout(timeout);
    }
}

function resolveRelayRuntimeInstallHealthcheckTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
    const raw = String(
        env.HAPPIER_RELAY_RUNTIME_INSTALL_HEALTHCHECK_TIMEOUT_MS
        ?? env.HAPPIER_RELAY_HOST_LOCAL_HEALTHCHECK_TIMEOUT_MS
        ?? '',
    ).trim();
    if (!raw) return DEFAULT_RELAY_RUNTIME_INSTALL_HEALTHCHECK_TIMEOUT_MS;

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_RELAY_RUNTIME_INSTALL_HEALTHCHECK_TIMEOUT_MS;
    }
    return Math.min(MAX_RELAY_RUNTIME_INSTALL_HEALTHCHECK_TIMEOUT_MS, Math.floor(parsed));
}

async function installBinaryShim(params: Readonly<{
    platform: NodeJS.Platform;
    sourcePath: string;
    destPath: string;
}>): Promise<void> {
    await mkdir(dirname(params.destPath), { recursive: true });
    await rm(params.destPath, { force: true });
    if (params.platform !== 'win32') {
        await symlink(params.sourcePath, params.destPath).catch(async () => {
            await copyFile(params.sourcePath, params.destPath);
            await chmod(params.destPath, 0o755).catch(() => undefined);
        });
        return;
    }
    await copyFile(params.sourcePath, params.destPath);
}

async function listRelayRuntimeManagedRootEntries(rootDir: string): Promise<string[]> {
    const result: string[] = [];
    for (const entryName of RELAY_RUNTIME_MANAGED_ROOT_ENTRIES) {
        if (await lstat(join(rootDir, entryName)).catch(() => null)) result.push(entryName);
    }
    return result;
}

async function copyNamedRootEntries(params: Readonly<{
    sourceDir: string;
    destDir: string;
    entryNames: readonly string[];
}>): Promise<void> {
    await mkdir(params.destDir, { recursive: true });
    for (const entryName of params.entryNames) {
        const sourcePath = join(params.sourceDir, entryName);
        const destPath = join(params.destDir, entryName);
        await removeRuntimePayloadPath(destPath);

        const info = await lstat(sourcePath).catch(() => null);
        if (!info) continue;

        if (info.isDirectory()) {
            await copyDirectoryContents({
                sourceDir: sourcePath,
                destDir: destPath,
            });
            continue;
        }

        if (info.isSymbolicLink()) {
            const linkTarget = await readlink(sourcePath).catch(() => null);
            if (!linkTarget) continue;
            await mkdir(dirname(destPath), { recursive: true });
            const targetInfo = await stat(join(dirname(sourcePath), linkTarget)).catch(() => null);
            await symlink(linkTarget, destPath, process.platform === 'win32' && targetInfo?.isDirectory() ? 'junction' : 'file');
            continue;
        }

        if (info.isFile()) {
            await mkdir(dirname(destPath), { recursive: true });
            await copyFile(sourcePath, destPath);
        }
    }
}

async function clearNamedRootEntries(params: Readonly<{
  rootDir: string;
  entryNames: readonly string[];
}>): Promise<void> {
  for (const entryName of params.entryNames) {
    await removeRuntimePayloadPath(join(params.rootDir, entryName));
  }
}

/**
 * Remove only the executable payload from a relay install.
 *
 * The config and data roots intentionally live below installRoot for user-mode
 * relays, so uninstall must never recursively remove that root. The persistent
 * root allowlist is shared with install/update state handling above.
 */
export async function uninstallRelayRuntimePayloadLocal(params: Readonly<{
  installRoot: string;
  shimPath: string;
  statePath: string;
  logDir: string;
  retainedPurpose?: ManagedRelayPurpose;
}>): Promise<void> {
  const entryNames = await listRelayRuntimeManagedRootEntries(params.installRoot);
  await clearNamedRootEntries({
    rootDir: params.installRoot,
    entryNames,
  });
  await removeRuntimePayloadPath(params.shimPath);
  if (params.retainedPurpose) {
    await writeJsonFile(params.statePath, { purpose: params.retainedPurpose });
  } else {
    await rm(params.statePath, { force: true });
  }
  await rm(params.logDir, { recursive: true, force: true });
}

async function installPersistentPayload(params: Readonly<{
    sourceDir: string;
    destDir: string;
    executablePath: string;
}>): Promise<void> {
    await mkdir(params.destDir, { recursive: true });
    const existingEntryNames = await listRelayRuntimeManagedRootEntries(params.destDir);
    await clearNamedRootEntries({
        rootDir: params.destDir,
        entryNames: existingEntryNames,
    });
    const entryNames = await listRelayRuntimeManagedRootEntries(params.sourceDir);
    await copyNamedRootEntries({
        sourceDir: params.sourceDir,
        destDir: params.destDir,
        entryNames,
    });
    if (!existsSync(params.executablePath)) {
        throw new Error(`[relay-runtime] failed to install server binary (${params.executablePath})`);
    }
    await chmod(params.executablePath, 0o755).catch(() => undefined);
}

async function prepareRelayRuntimePayloadForInstall(params: Readonly<{
    serverBinaryPath: string;
    serverBinaryName: string;
}>): Promise<Readonly<{
    payloadRoot: string;
    cleanupPath: string | null;
}>> {
    const payloadRoot = resolveServerRuntimePayloadRootFromBinaryPath(params.serverBinaryPath);
    const serverBinaryIsNestedUnderBin = dirname(params.serverBinaryPath) === join(payloadRoot, 'bin');
    if (serverBinaryIsNestedUnderBin) {
        return {
            payloadRoot,
            cleanupPath: null,
        };
    }

    const stagingRoot = await mkdtemp(join(tmpdir(), '.relay-runtime-payload-'));
    try {
        await copyDirectoryContents({
            sourceDir: payloadRoot,
            destDir: stagingRoot,
        });

        await relocateServerRuntimeArtifactClosure({
            payloadRoot: stagingRoot,
            platform: params.serverBinaryName.endsWith('.exe') ? 'win32' : process.platform,
        });
    } catch (error) {
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }

    return {
        payloadRoot: stagingRoot,
        cleanupPath: stagingRoot,
    };
}

async function backupRelayRuntimeInstallState(params: Readonly<{
    installRoot: string;
    payloadDir: string;
    serverBinaryName: string;
    migrationsDir: string;
    envPath: string;
    statePath: string;
}>): Promise<Readonly<{
    backupRoot: string;
    payloadBackupDir: string | null;
    hasRestorableServerBinary: boolean;
    migrationsBackupDir: string | null;
    previousEnvText: string | null;
    previousStateText: string | null;
}>> {
    const backupRoot = await mkdtemp(join(dirname(params.installRoot), '.relay-runtime-backup-'));
    const payloadBackupDir = join(backupRoot, 'payload');
    const migrationsBackupDir = join(backupRoot, 'migrations');
    const existingEntryNames = await listRelayRuntimeManagedRootEntries(params.payloadDir);
    const hasPayloadEntries = existingEntryNames.length > 0;
    const hasRestorableServerBinary = existsSync(join(params.payloadDir, 'bin', params.serverBinaryName));
    const hasMigrations = existsSync(params.migrationsDir);
    if (hasPayloadEntries) {
        await copyNamedRootEntries({
            sourceDir: params.payloadDir,
            destDir: payloadBackupDir,
            entryNames: existingEntryNames,
        });
    }
    if (hasMigrations) {
        await copyDirectoryContents({
            sourceDir: params.migrationsDir,
            destDir: migrationsBackupDir,
        });
    }
    return {
        backupRoot,
        payloadBackupDir: hasPayloadEntries ? payloadBackupDir : null,
        hasRestorableServerBinary,
        migrationsBackupDir: hasMigrations ? migrationsBackupDir : null,
        previousEnvText: existsSync(params.envPath)
            ? await readFile(params.envPath, 'utf8').catch(() => null)
            : null,
        previousStateText: existsSync(params.statePath)
            ? await readFile(params.statePath, 'utf8').catch(() => null)
            : null,
    };
}

async function restoreRelayRuntimeInstallState(params: Readonly<{
    platform: NodeJS.Platform;
    payloadDir: string;
    shimPath: string;
    migrationsDir: string;
    envPath: string;
    statePath: string;
    payloadBackupDir: string | null;
    migrationsBackupDir: string | null;
    previousEnvText: string | null;
    previousStateText: string | null;
}>): Promise<void> {
    const currentEntryNames = await listRelayRuntimeManagedRootEntries(params.payloadDir);
    await clearNamedRootEntries({
        rootDir: params.payloadDir,
        entryNames: currentEntryNames,
    });
    if (params.payloadBackupDir) {
        const backupEntryNames = await listRelayRuntimeManagedRootEntries(params.payloadBackupDir);
        await copyNamedRootEntries({
            sourceDir: params.payloadBackupDir,
            destDir: params.payloadDir,
            entryNames: backupEntryNames,
        });
    }
    await rm(params.shimPath, { force: true });
    if (params.payloadBackupDir) {
        const serverBinaryName = params.platform === 'win32' ? 'happier-server.exe' : 'happier-server';
        const sourcePath = join(params.payloadDir, 'bin', serverBinaryName);
        if (existsSync(sourcePath)) {
            await installBinaryShim({
                platform: params.platform,
                sourcePath,
                destPath: params.shimPath,
            });
        }
    }
    await rm(params.migrationsDir, { recursive: true, force: true });
    if (params.migrationsBackupDir) {
        await copyDirectoryContents({
            sourceDir: params.migrationsBackupDir,
            destDir: params.migrationsDir,
        });
    }
    if (typeof params.previousEnvText === 'string') {
        await mkdir(dirname(params.envPath), { recursive: true });
        await writeFile(params.envPath, params.previousEnvText, 'utf8');
    } else {
        await rm(params.envPath, { force: true });
    }
    if (typeof params.previousStateText === 'string') {
        await mkdir(dirname(params.statePath), { recursive: true });
        await writeFile(params.statePath, params.previousStateText, 'utf8');
        return;
    }
    await rm(params.statePath, { force: true });
}

function buildRelayRuntimeServiceSpec(params: Readonly<{
    serviceName: string;
    installRoot: string;
    serverBinaryPath: string;
    env: Record<string, string>;
    stdoutPath: string;
    stderrPath: string;
}>): ServiceSpec {
    return {
        label: params.serviceName,
        description: `Happier Relay Runtime (${params.serviceName})`,
        programArgs: [params.serverBinaryPath],
        workingDirectory: params.installRoot,
        env: params.env,
        stdoutPath: params.stdoutPath,
        stderrPath: params.stderrPath,
    };
}

async function installOrUpdateRelayRuntimeLocalUnderMutationLocks(params: Readonly<{
    serverBinaryPath: string;
    channel: 'stable' | 'preview' | 'publicdev';
    mode: 'user' | 'system';
    env?: Record<string, string>;
    platform?: NodeJS.Platform;
    homeDir?: string;
    arch?: string;
    version?: string | null;
    serviceNameOverride?: string;
    runServiceCommands?: boolean;
    skipHealthCheck?: boolean;
    purpose?: ManagedRelayPurpose;
    runMigrationCommand?: (params: Readonly<{
        command: string;
        args: readonly string[];
        cwd: string;
        env: Record<string, string>;
    }>) => Promise<void>;
    /** Verified lease-held Personal Home restore point; an empty first install returns null. */
    createPersonalHomeRestorePoint?: (context: Readonly<{
        happierVersion: string | null;
    }>) => Promise<PersonalHomeRestorePoint | null>;
    /** Canonical owner hooks used to restore the verified snapshot under the held Home lease. */
    personalHomeRestoreHooks?: PersonalHomeRestoreHooks;
    /** RelayHostEngine-owned lifecycle assertion, required for Personal Home mutation. */
    assertPersonalHomeStopped?: () => Promise<void>;
}>, rootMigrationSource: RelayRuntimeInstallRootMigrationSource | null): Promise<Readonly<{ baseUrl: string; version: string | null }>> {
    const platform = (String(params.platform ?? '').trim() || process.platform) as NodeJS.Platform;
    const homeDir = String(params.homeDir ?? '').trim() || homedir();
    const arch = String(params.arch ?? '').trim() || process.arch;
    const mode = params.mode === 'system' ? 'system' : 'user';
    const serverBinaryName = platform === 'win32' ? 'happier-server.exe' : 'happier-server';

    assertRootIfRequired({ platform, mode });

    const defaults = resolveRelayRuntimeDefaults({
        platform,
        mode,
        channel: params.channel,
        homeDir,
    });
    if (params.purpose?.kind === 'personal-home') {
        assertPersonalHomeEnvironmentKeys(params.env ?? {});
        if (!params.assertPersonalHomeStopped) {
            throw new Error('[relay-runtime] Personal Home upgrade requires the canonical stopped-Home assertion');
        }
    }
    const serviceName = String(params.serviceNameOverride ?? '').trim() || defaults.serviceName;
    const installServerBinaryPath = join(defaults.installRoot, 'bin', serverBinaryName);
    const statePath = join(defaults.installRoot, 'self-host-state.json');
    const configEnvPath = join(defaults.configDir, 'server.env');
    const filesDir = join(defaults.dataDir, 'files');
    const dbDir = join(defaults.dataDir, 'pglite');
    const migrationsDir = join(defaults.dataDir, 'migrations', 'sqlite');
    const stdoutPath = join(defaults.logDir, 'server.out.log');
    const stderrPath = join(defaults.logDir, 'server.err.log');
    const startupReceiptPath = join(defaults.dataDir, 'startup-receipt.json');
    const startupReceiptNonce = randomUUID();
    const backend: ServiceBackend = resolveServiceBackend({
        platform,
        mode,
    });
    const previousServiceSpec = buildRelayRuntimeServiceSpec({
        serviceName,
        installRoot: defaults.installRoot,
        serverBinaryPath: installServerBinaryPath,
        env: {},
        stdoutPath,
        stderrPath,
    });
    const previousServiceDefinition = buildServiceDefinition({
        backend,
        homeDir,
        spec: previousServiceSpec,
    });
    const previousServiceDefinitionExisted = existsSync(previousServiceDefinition.path);

    if (!existsSync(params.serverBinaryPath)) {
        throw new Error('[relay-runtime] server binary not found');
    }

    const preparedPayload = await prepareRelayRuntimePayloadForInstall({
        serverBinaryPath: params.serverBinaryPath,
        serverBinaryName,
    });
    let previousInstallState: Awaited<ReturnType<typeof backupRelayRuntimeInstallState>> | null = null;
    let ownedRootMigration: RelayRuntimeInstallRootMigration | null = null;
    let legacyRootMigration: RelayRuntimeInstallRootMigration | null = null;
    let restoreInstallRoot = defaults.installRoot;
    let candidateServiceActivationAttempted = false;
    let personalHomeRestorePoint: PersonalHomeRestorePoint | null = null;
    let personalHomeRestoreRollbackPaths: readonly string[] | undefined;
    let preserveRecoveryArtifacts = false;
    let candidateStateCommitted = false;

    try {
        ownedRootMigration = rootMigrationSource?.kind === 'owned-current-lane'
            ? await migrateOwnedCurrentLaneRelayRuntimeInstallRootIfNeeded({
                platform,
                mode,
                channel: params.channel,
                homeDir,
                runServiceCommands: params.runServiceCommands !== false,
                sourceInstallRoot: rootMigrationSource.sourceInstallRoot,
                assertPersonalHomeStopped: params.assertPersonalHomeStopped,
            })
            : null;

        legacyRootMigration = ownedRootMigration
            ? null
            : rootMigrationSource?.kind === 'legacy-unsuffixed'
                ? await migrateLegacyUnsuffixedRelayRuntimeInstallRootIfNeeded({
                    platform,
                    mode,
                    channel: params.channel,
                    homeDir,
                    runServiceCommands: params.runServiceCommands !== false,
                    sourceInstallRoot: rootMigrationSource.sourceInstallRoot,
                    assertPersonalHomeStopped: params.assertPersonalHomeStopped,
                })
                : null;

        restoreInstallRoot = ownedRootMigration?.originalInstallRoot
            ?? legacyRootMigration?.originalInstallRoot
            ?? defaults.installRoot;

        await mkdir(defaults.installRoot, { recursive: true });
        previousInstallState = await backupRelayRuntimeInstallState({
            installRoot: defaults.installRoot,
            payloadDir: defaults.installRoot,
            serverBinaryName,
            migrationsDir,
            envPath: configEnvPath,
            statePath,
        });

        if (params.purpose?.kind === 'personal-home') {
            const previousState = tryParseJsonObject(previousInstallState.previousStateText ?? '');
            // The existing state file is the runtime-classification owner. Publish the immutable
            // requested purpose before payload, data, environment, or service mutation so a hard
            // termination cannot turn the runtime Lane 03 created into an unclassified install.
            await writeJsonFile(statePath, {
                ...(previousState ?? {}),
                purpose: params.purpose,
            });
        }

        await mkdir(defaults.configDir, { recursive: true });
        await mkdir(defaults.dataDir, { recursive: true });
        await mkdir(filesDir, { recursive: true });
        await mkdir(dbDir, { recursive: true });
        await mkdir(defaults.logDir, { recursive: true });

        if (params.runServiceCommands !== false) {
            const stopServiceSpec = buildRelayRuntimeServiceSpec({
                serviceName,
                installRoot: defaults.installRoot,
                serverBinaryPath: installServerBinaryPath,
                env: {},
                stdoutPath,
                stderrPath,
            });
            const stopDefinition = buildServiceDefinition({
                backend,
                homeDir,
                spec: stopServiceSpec,
            });
            const stopPlan = planServiceAction({
                backend,
                action: 'stop',
                label: stopServiceSpec.label,
                definitionPath: stopDefinition.path,
                persistent: true,
            });
            await applyServicePlan(stopPlan, {
                runCommands: true,
            });
        }
        await params.assertPersonalHomeStopped?.();

        if (params.createPersonalHomeRestorePoint) {
            const previousState = tryParseJsonObject(previousInstallState.previousStateText ?? '');
            const previousVersion = typeof previousState?.version === 'string' && previousState.version.trim()
                ? previousState.version.trim()
                : null;
            const candidateVersion = typeof params.version === 'string' && params.version.trim()
                ? params.version.trim()
                : null;
            personalHomeRestorePoint = await params.createPersonalHomeRestorePoint({
                happierVersion: previousVersion ?? candidateVersion,
            });
        }

        const payloadRoot = preparedPayload.payloadRoot;
        const migrationsSourceDir = join(payloadRoot, 'bin', 'prisma', 'sqlite', 'migrations');
        await mkdir(migrationsDir, { recursive: true });
        if (existsSync(migrationsSourceDir)) {
            await copyDirectoryContents({
                sourceDir: migrationsSourceDir,
                destDir: migrationsDir,
            });
        }

        await installPersistentPayload({
            sourceDir: payloadRoot,
            destDir: defaults.installRoot,
            executablePath: installServerBinaryPath,
        });
        await installBinaryShim({
            platform,
            sourcePath: installServerBinaryPath,
            destPath: join(defaults.binDir, serverBinaryName),
        });

        const uiDir = platform === 'win32'
            ? win32Path.join(defaults.installRoot, 'ui-web', 'current')
            : join(defaults.installRoot, 'ui-web', 'current');
        const uiIndexPath = join(uiDir, 'index.html');
        const uiDeployment = existsSync(uiIndexPath)
            ? resolveUiDeploymentIdentity({
                digest: await computeUiDeploymentDigest(uiDir),
                previousStateText: previousInstallState.previousStateText,
                generateId: randomUUID,
            })
            : null;
        const existingEnvText = existsSync(configEnvPath) ? await readFile(configEnvPath, 'utf8').catch(() => '') : '';
        const existingPortRaw = existingEnvText ? String(parseEnvText(existingEnvText).PORT ?? '').trim() : '';
        const overridePortRaw = String((params.env ?? {}).PORT ?? '').trim();
        const configuredPortRaw = overridePortRaw || existingPortRaw;
        const configuredPort = configuredPortRaw && Number.isInteger(Number.parseInt(configuredPortRaw, 10))
            ? Number.parseInt(configuredPortRaw, 10)
            : null;
        const resolvedPort = await resolveNonCollidingRelayPort({
            platform,
            mode,
            channel: params.channel,
            homeDir,
            defaultPort: defaults.serverPort,
            configuredPort,
            explicitConfiguredPort: Boolean(overridePortRaw),
        });
        const baseEnvText = renderSelfHostServerEnvText({
            port: resolvedPort,
            host: defaults.serverHost,
            dataDir: defaults.dataDir,
            filesDir,
            dbDir,
            uiDir,
            uiDeploymentId: uiDeployment?.deploymentId,
            serverBinDir: dirname(installServerBinaryPath),
            arch,
            platform,
        });
        const preservedClosedSignup = params.purpose?.kind === 'personal-home'
            && readEffectivePersonalHomeSignupPolicy(existingEnvText) === 'disabled';
        const personalHomeEnv = params.purpose?.kind === 'personal-home'
            ? renderPersonalHomeRuntimeEnv({
                spec: createPersonalHomeRuntimeSpec({ canonicalServerUrl: params.purpose.canonicalServerUrl }),
                port: resolvedPort,
                overrides: {
                    ...(params.env ?? {}),
                    ...(preservedClosedSignup ? { AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' } : {}),
                },
            })
            : null;
        // Home device approval is owned by the Home auth/enrollment path. It is
        // intentionally not part of the Personal Home fixed renderer, but a
        // process-level setting must survive the first managed env write when
        // no prior server.env exists. Preserve an existing file value above;
        // only carry the inherited setting when the file has no assignment.
        const approvalKey = 'HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED';
        const inheritedApproval = params.purpose?.kind === 'personal-home'
            && !Object.prototype.hasOwnProperty.call(parseEnvText(existingEnvText), approvalKey)
            && Object.prototype.hasOwnProperty.call(process.env, approvalKey)
            ? String(process.env[approvalKey] ?? '')
            : null;
        const envText = mergeSelfHostServerEnvText({
            baseEnvText,
            existingEnvText,
            overrides: {
                ...(params.env ?? {}),
                ...(personalHomeEnv ?? {}),
                ...(params.purpose ? { [MANAGED_RELAY_PURPOSE_ENV]: params.purpose.kind } : {}),
                ...(inheritedApproval !== null ? { [approvalKey]: inheritedApproval } : {}),
                PORT: String(resolvedPort),
            },
        });
        await writeFile(configEnvPath, envText, 'utf8');
        const env = parseEnvText(envText);
        const migrationPlan = resolveSelfHostServerMigrationPlan({
            serverBinaryPath: installServerBinaryPath,
            env,
            platform,
        });
        if (migrationPlan) {
            if (params.runMigrationCommand) {
                await params.runMigrationCommand({
                    ...migrationPlan,
                    cwd: defaults.installRoot,
                    env,
                });
            } else {
                const completion = spawnSync(migrationPlan.command, [...migrationPlan.args], {
                    cwd: defaults.installRoot,
                    env: { ...process.env, ...env },
                    stdio: 'inherit',
                });
                if (completion.error) {
                    throw new Error(`[relay-runtime] database migration failed to start: ${completion.error.message}`);
                }
                if (completion.status !== 0) {
                    throw new Error(`[relay-runtime] database migration exited with status ${completion.status ?? 'unknown'}`);
                }
            }
        }

        await rm(startupReceiptPath, { force: true });
        const serviceSpec = buildRelayRuntimeServiceSpec({
            serviceName,
            installRoot: defaults.installRoot,
            serverBinaryPath: installServerBinaryPath,
            env: {
                ...env,
                [SERVER_STARTUP_RECEIPT_PATH_ENV]: startupReceiptPath,
                [SERVER_STARTUP_RECEIPT_NONCE_ENV]: startupReceiptNonce,
            },
            stdoutPath,
            stderrPath,
        });
        const definition = buildServiceDefinition({
            backend,
            homeDir,
            spec: serviceSpec,
        });
        const plan = planServiceAction({
            backend,
            action: 'install',
            label: serviceSpec.label,
            definitionPath: definition.path,
            definitionContents: definition.contents,
            persistent: true,
        });
        candidateServiceActivationAttempted = params.runServiceCommands !== false;
        await applyServicePlan(plan, {
            runCommands: params.runServiceCommands !== false,
        });

        const state = {
            channel: params.channel,
            mode,
            version: typeof params.version === 'string' && params.version.trim() ? params.version.trim() : null,
            updatedAt: new Date().toISOString(),
            ...(params.purpose ? { purpose: params.purpose } : {}),
            ...(uiDeployment ? {
                uiDeploymentDigest: uiDeployment.digest,
                uiDeploymentId: uiDeployment.deploymentId,
            } : {}),
        };
        const baseUrl = resolveConfiguredSelfHostBaseUrl({
            fallbackBaseUrl: `http://${defaults.serverHost}:${defaults.serverPort}`,
            envText,
        });
        if (params.skipHealthCheck !== true && params.runServiceCommands !== false) {
            const baseUrlObject = new URL(baseUrl);
            const result = await checkRelayRuntimeHealth({
                host: baseUrlObject.hostname,
                port: Number.parseInt(baseUrlObject.port, 10),
                timeoutMs: resolveRelayRuntimeInstallHealthcheckTimeoutMs(),
                probePortOpen: async ({ host, port, timeoutMs }) => await probePortOpen({ host, port, timeoutMs }),
                fetchJson: async ({ url, timeoutMs }) => await fetchJson({ url, timeoutMs }),
            });
            if (!result.reachable) {
                throw new Error(`[relay-runtime] relay runtime did not become healthy (${result.url})`);
            }
            const startupReceipt = await waitForRelayRuntimeStartupReceipt({
                path: startupReceiptPath,
                nonce: startupReceiptNonce,
            });
            if (params.purpose?.kind === 'personal-home') {
                if (
                    startupReceipt.host !== baseUrlObject.hostname
                    || startupReceipt.host !== '127.0.0.1'
                    || startupReceipt.port !== Number.parseInt(baseUrlObject.port, 10)
                ) {
                    throw new Error('[relay-runtime] Personal Home startup listener does not match its stable loopback origin');
                }
            }
        }

        if (
            personalHomeRestorePoint
            && params.personalHomeRestoreHooks?.verifyIdentity
            && !(await params.personalHomeRestoreHooks.verifyIdentity(personalHomeRestorePoint.backup.manifest))
        ) {
            throw new Error('[relay-runtime] Personal Home identity verification failed after activation');
        }

        await writeJsonFile(statePath, state);
        candidateStateCommitted = true;
        if (personalHomeRestorePoint) {
            await personalHomeRestorePoint.dispose();
            personalHomeRestorePoint = null;
        }

        return {
            baseUrl,
            version: state.version,
        };
    } catch (error) {
        if (candidateStateCommitted) throw error;
        await rm(startupReceiptPath, { force: true }).catch(() => undefined);
        const rollbackFailures: RelayRuntimeInstallRollbackFailure[] = [];
        let rollbackCanProceed = true;

        if (candidateServiceActivationAttempted) {
            try {
                const candidateStopSpec = buildRelayRuntimeServiceSpec({
                    serviceName,
                    installRoot: defaults.installRoot,
                    serverBinaryPath: installServerBinaryPath,
                    env: {},
                    stdoutPath,
                    stderrPath,
                });
                const candidateStopDefinition = buildServiceDefinition({
                    backend,
                    homeDir,
                    spec: candidateStopSpec,
                });
                const candidateStopPlan = planServiceAction({
                    backend,
                    action: 'stop',
                    label: candidateStopSpec.label,
                    definitionPath: candidateStopDefinition.path,
                    persistent: true,
                });
                await applyServicePlan(candidateStopPlan, { runCommands: true });
            } catch (rollbackError) {
                rollbackFailures.push({ phase: 'candidate_stop', error: rollbackError });
                rollbackCanProceed = false;
            }
        }

        if (rollbackCanProceed && previousInstallState) {
            try {
                await restoreRelayRuntimeInstallState({
                    platform,
                    payloadDir: defaults.installRoot,
                    shimPath: join(defaults.binDir, serverBinaryName),
                    migrationsDir,
                    envPath: configEnvPath,
                    statePath,
                    payloadBackupDir: previousInstallState.payloadBackupDir,
                    migrationsBackupDir: previousInstallState.migrationsBackupDir,
                    previousEnvText: previousInstallState.previousEnvText,
                    previousStateText: previousInstallState.previousStateText,
                });
            } catch (rollbackError) {
                rollbackFailures.push({ phase: 'runtime_restore', error: rollbackError });
                rollbackCanProceed = false;
            }
        }

        if (rollbackCanProceed && personalHomeRestorePoint) {
            try {
                const restoreResult = await personalHomeRestorePoint.restore(params.personalHomeRestoreHooks ?? {});
                personalHomeRestoreRollbackPaths = restoreResult.rollbackPaths;
                if (restoreResult.outcome !== 'restored') {
                    throw new Error(`[relay-runtime] Personal Home restore did not complete (${restoreResult.outcome})${restoreResult.error ? `: ${restoreResult.error}` : ''}`);
                }
            } catch (rollbackError) {
                rollbackFailures.push({ phase: 'personal_home_restore', error: rollbackError });
                rollbackCanProceed = false;
            }
        }

        if (rollbackCanProceed && previousInstallState && (ownedRootMigration || legacyRootMigration) && params.runServiceCommands !== false) {
            try {
                const migratedRollbackSpec = buildRelayRuntimeServiceSpec({
                    serviceName,
                    installRoot: defaults.installRoot,
                    serverBinaryPath: join(defaults.installRoot, 'bin', serverBinaryName),
                    env: {},
                    stdoutPath,
                    stderrPath,
                });
                const migratedRollbackDefinition = buildServiceDefinition({
                    backend,
                    homeDir,
                    spec: migratedRollbackSpec,
                });
                const migratedRollbackPlan = planServiceAction({
                    backend,
                    action: 'uninstall',
                    label: migratedRollbackSpec.label,
                    definitionPath: migratedRollbackDefinition.path,
                    persistent: true,
                });
                await applyServicePlan(migratedRollbackPlan, { runCommands: true });
                await rm(migratedRollbackDefinition.path, { force: true }).catch(() => undefined);
            } catch (rollbackError) {
                rollbackFailures.push({ phase: 'service_restore', error: rollbackError });
                rollbackCanProceed = false;
            }
        }

        if (rollbackCanProceed) {
            for (const migration of [ownedRootMigration, legacyRootMigration]) {
                if (!migration) continue;
                try {
                    await rollbackRelayRuntimeInstallRootMigration(migration);
                } catch (rollbackError) {
                    rollbackFailures.push({ phase: 'install_root_restore', error: rollbackError });
                    rollbackCanProceed = false;
                    break;
                }
            }
        }

        if (rollbackCanProceed && previousInstallState && !ownedRootMigration && !legacyRootMigration) {
            try {
                if (previousServiceDefinitionExisted && previousInstallState.hasRestorableServerBinary) {
                    const restoreEnv = parseEnvText(previousInstallState.previousEnvText ?? '');
                    const restoreSpec = buildRelayRuntimeServiceSpec({
                        serviceName,
                        installRoot: restoreInstallRoot,
                        serverBinaryPath: join(restoreInstallRoot, 'bin', serverBinaryName),
                        env: restoreEnv,
                        stdoutPath,
                        stderrPath,
                    });
                    const restoreDefinition = buildServiceDefinition({
                        backend,
                        homeDir,
                        spec: restoreSpec,
                    });
                    const restorePlan = planServiceAction({
                        backend,
                        action: 'install',
                        label: restoreSpec.label,
                        definitionPath: restoreDefinition.path,
                        definitionContents: restoreDefinition.contents,
                        persistent: true,
                    });
                    await applyServicePlan(restorePlan, {
                        runCommands: params.runServiceCommands !== false,
                    });
                    if (params.runServiceCommands !== false && params.skipHealthCheck !== true) {
                        const rollbackBaseUrl = resolveConfiguredSelfHostBaseUrl({
                            fallbackBaseUrl: `http://${defaults.serverHost}:${defaults.serverPort}`,
                            envText: previousInstallState.previousEnvText ?? '',
                        });
                        const rollbackBaseUrlObject = new URL(rollbackBaseUrl);
                        const rollbackHealth = await checkRelayRuntimeHealth({
                            host: rollbackBaseUrlObject.hostname,
                            port: Number.parseInt(rollbackBaseUrlObject.port, 10),
                            timeoutMs: resolveRelayRuntimeInstallHealthcheckTimeoutMs(),
                            probePortOpen: async ({ host, port, timeoutMs }) => await probePortOpen({ host, port, timeoutMs }),
                            fetchJson: async ({ url, timeoutMs }) => await fetchJson({ url, timeoutMs }),
                        });
                        if (!rollbackHealth.reachable) {
                            throw new Error(`[relay-runtime] previous relay runtime did not become healthy after rollback (${rollbackHealth.url})`);
                        }
                    }
                } else if (params.runServiceCommands !== false) {
                    const rollbackSpec = buildRelayRuntimeServiceSpec({
                        serviceName,
                        installRoot: restoreInstallRoot,
                        serverBinaryPath: join(restoreInstallRoot, 'bin', serverBinaryName),
                        env: {},
                        stdoutPath,
                        stderrPath,
                    });
                    const rollbackDefinition = buildServiceDefinition({
                        backend,
                        homeDir,
                        spec: rollbackSpec,
                    });
                    const rollbackPlan = planServiceAction({
                        backend,
                        action: 'uninstall',
                        label: rollbackSpec.label,
                        definitionPath: rollbackDefinition.path,
                        persistent: true,
                    });
                    await applyServicePlan(rollbackPlan, { runCommands: true });
                    if (!previousServiceDefinitionExisted) {
                        await rm(rollbackDefinition.path, { force: true }).catch(() => undefined);
                    }
                }
            } catch (rollbackError) {
                rollbackFailures.push({ phase: 'service_restore', error: rollbackError });
                rollbackCanProceed = false;
            }
        }

        if (rollbackCanProceed && personalHomeRestorePoint) {
            try {
                for (const rollbackPath of personalHomeRestoreRollbackPaths ?? []) {
                    await rm(rollbackPath, { recursive: true, force: true });
                }
                personalHomeRestoreRollbackPaths = undefined;
                await personalHomeRestorePoint.dispose();
                personalHomeRestorePoint = null;
            } catch (rollbackError) {
                rollbackFailures.push({ phase: 'artifact_disposal', error: rollbackError });
                rollbackCanProceed = false;
            }
        }

        if (!rollbackCanProceed || rollbackFailures.length > 0) {
            preserveRecoveryArtifacts = true;
            throw new RelayRuntimeInstallRollbackIncompleteError(error, rollbackFailures, {
                ...(previousInstallState ? { runtimeBackupRoot: previousInstallState.backupRoot } : {}),
                ...(personalHomeRestorePoint ? { personalHomeRestorePointPath: personalHomeRestorePoint.backup.path } : {}),
                ...(personalHomeRestoreRollbackPaths ? { personalHomeRestoreRollbackPaths } : {}),
            });
        }
        throw error;
    } finally {
        if (preparedPayload.cleanupPath) {
            await rm(preparedPayload.cleanupPath, { recursive: true, force: true }).catch(() => undefined);
        }
        if (previousInstallState && !preserveRecoveryArtifacts) {
            await rm(previousInstallState.backupRoot, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}

export async function installOrUpdateRelayRuntimeLocal(
    params: Parameters<typeof installOrUpdateRelayRuntimeLocalUnderMutationLocks>[0],
): ReturnType<typeof installOrUpdateRelayRuntimeLocalUnderMutationLocks> {
    const platform = (String(params.platform ?? '').trim() || process.platform) as NodeJS.Platform;
    const homeDir = String(params.homeDir ?? '').trim() || homedir();
    const mode = params.mode === 'system' ? 'system' : 'user';
    assertRootIfRequired({ platform, mode });
    const defaults = resolveRelayRuntimeDefaults({
        platform,
        mode,
        channel: params.channel,
        homeDir,
    });

    return withFirstPartyPayloadMutationLock({
        installRoot: defaults.installRoot,
        lockParentDir: dirname(defaults.installRoot),
        operation: async () => {
            const rootMigrationSource = await resolveRelayRuntimeInstallRootMigrationSource({
                platform,
                mode,
                channel: params.channel,
                homeDir,
            });
            if (params.purpose?.kind === 'personal-home') {
                // A user-mode legacy migration renames the complete install root, including its
                // persistent data directory. Lock that existing Home before the move; creating a
                // second destination lock would itself create the destination and defeat the
                // atomic rename. The lock owner releases the same token at its moved path.
                const sourceDataDir = await resolvePersonalHomeRuntimeDataDirForInstallRoot({
                    platform,
                    mode,
                    channel: params.channel,
                    homeDir,
                    installRoot: rootMigrationSource?.sourceInstallRoot ?? defaults.installRoot,
                });
                const destinationDataDir = rootMigrationSource
                    ? await resolvePersonalHomeRuntimeDataDirForInstallRoot({
                        platform,
                        mode,
                        channel: params.channel,
                        homeDir,
                        installRoot: defaults.installRoot,
                    })
                    : sourceDataDir;
                return withPersonalHomeOperationLock(
                    sourceDataDir,
                    'upgrade',
                    async () => {
                        await assertPersonalHomeRelocationAllowsActivation(sourceDataDir);
                        return installOrUpdateRelayRuntimeLocalUnderMutationLocks(params, rootMigrationSource);
                    },
                    rootMigrationSource && sourceDataDir !== destinationDataDir
                        ? { movedToDataDir: destinationDataDir }
                        : {},
                );
            }
            return installOrUpdateRelayRuntimeLocalUnderMutationLocks(params, rootMigrationSource);
        },
    });
}
