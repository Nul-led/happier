import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createConnection } from 'node:net';

import {
    execFileWithDeadline,
    resolveWindowsCommandInvocation,
    type CommandInvocation,
} from '@happier-dev/cli-common/process';
import type { CatalogAgentLookupId } from '@/agent/catalog/types';
import type {
    AttachAvailabilityRequestV1,
    AttachSessionMetadataV1,
} from '@happier-dev/agents';
import type {
    AgentProviderCliAttachReachabilityV1,
    AttachSurface,
} from '@happier-dev/plugin-sdk/agents/runtime';
import type { AgentCliLaunchSpec } from '@/packagedRuntime/managedTools/requireAgentCliLaunchSpec';
import { requireAgentCliLaunchSpec } from '@/packagedRuntime/managedTools/requireAgentCliLaunchSpec';
import { logger } from '@/ui/logger';

type SpawnedAttachProcess = Readonly<{
    exitCode?: number | null;
    once: {
        (event: 'exit', handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
        (event: 'error', handler: (error: Error) => void): void;
    };
    kill: (signal?: NodeJS.Signals | number) => boolean;
}>;

const PROVIDER_ATTACH_STOP_GRACE_MS = 3_000;

type ProviderCliAttachHostFacts = Readonly<{ cliVersion: string | null }>;

export type ProviderCliAttachManagedServiceAccess = Readonly<{
    baseUrl: string;
    request(input: Readonly<{
        pathAndQuery: string;
        signal: AbortSignal;
    }>): Promise<Readonly<{ ok: boolean }>>;
    childEnvironment: Readonly<Record<string, string>>;
}>;

async function readProviderCliVersion(params: Readonly<{
    launch: AgentCliLaunchSpec;
    args: readonly string[];
    env: NodeJS.ProcessEnv;
}>): Promise<string | null> {
    try {
        const result = await execFileWithDeadline(
            params.launch.command,
            [...params.launch.args, ...params.args],
            {
                env: params.env,
                timeout: 5_000,
                windowsHide: true,
            },
        );
        const stdout = typeof result.stdout === 'string'
            ? result.stdout
            : result.stdout.toString('utf8');
        const normalized = stdout.trim();
        return normalized.length > 0 ? normalized : null;
    } catch {
        return null;
    }
}

export type ProviderCliAttachTargetResult<TTarget extends object> =
    | Readonly<{ ok: true; value: TTarget }>
    | Readonly<{ ok: false; reason: string }>;

export type ProviderCliAttachTargetResolver<TTarget extends object> = (params: Readonly<{
    metadata: AttachSessionMetadataV1;
    fallbackServerBaseUrl?: string | null;
}>) => ProviderCliAttachTargetResult<TTarget>;

export async function probeLocalSocket(
    path: string,
    timeoutMs: number,
    dependencies: Readonly<{
        platform?: NodeJS.Platform;
        statPath?: typeof stat;
    }> = {},
): Promise<boolean> {
    if ((dependencies.platform ?? process.platform) === 'win32') {
        try {
            await (dependencies.statPath ?? stat)(path);
            return true;
        } catch {
            return false;
        }
    }
    return await new Promise<boolean>((resolve) => {
        const socket = createConnection(path);
        let settled = false;
        const finish = (reachable: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.destroy();
            resolve(reachable);
        };
        const timeout = setTimeout(() => finish(false), timeoutMs);
        timeout.unref?.();
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

function isLocalAttachRequest(request: AttachAvailabilityRequestV1): boolean {
    if (request.hasLocalAttachmentInfo === true) return true;
    if (
        request.currentMachineId
        && request.sessionMachineId
        && request.currentMachineId === request.sessionMachineId
    ) {
        return true;
    }
    return false;
}

async function readFallbackServerBaseUrl(params: Readonly<{
    sessionId: string;
    readFallbackServerBaseUrl?: (
        input: Readonly<{ sessionId: string }>,
    ) => Promise<string | null>;
}>): Promise<string | null> {
    if (!params.readFallbackServerBaseUrl) return null;
    try {
        const value = await params.readFallbackServerBaseUrl({ sessionId: params.sessionId });
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    } catch {
        return null;
    }
}

async function resolveTargetWithFallback<TTarget extends object>(params: Readonly<{
    metadata: AttachSessionMetadataV1;
    sessionId: string;
    resolver: ProviderCliAttachTargetResolver<TTarget>;
    readFallbackServerBaseUrl?: (
        input: Readonly<{ sessionId: string }>,
    ) => Promise<string | null>;
}>): Promise<ProviderCliAttachTargetResult<TTarget>> {
    const fallbackServerBaseUrl = await readFallbackServerBaseUrl({
        sessionId: params.sessionId,
        readFallbackServerBaseUrl: params.readFallbackServerBaseUrl,
    });
    return params.resolver({
        metadata: params.metadata,
        fallbackServerBaseUrl,
    });
}

export function createProviderCliAttachSurface<TTarget extends object>(params: Readonly<{
    agentId: CatalogAgentLookupId;
    resolveTarget: ProviderCliAttachTargetResolver<TTarget>;
    createArgs: (target: TTarget, host: ProviderCliAttachHostFacts) => readonly string[];
    resolveReachability?: (
        target: TTarget,
        host: ProviderCliAttachHostFacts,
    ) => AgentProviderCliAttachReachabilityV1 | null;
    cliVersionArgs?: readonly string[];
    resolveCliVersion?: (input: Readonly<{
        launch: AgentCliLaunchSpec;
        args: readonly string[];
        env: NodeJS.ProcessEnv;
    }>) => Promise<string | null>;
    readFallbackServerBaseUrl?: (
        input: Readonly<{ sessionId: string }>,
    ) => Promise<string | null>;
    managedServiceTargetBaseUrl?: (target: TTarget) => string | null;
    managedServiceCredentialEnvironmentKey?: string;
    managedServiceCredentialEnvironmentAliases?: readonly string[];
    resolveManagedServiceAccess?: (input: Readonly<{
        sessionId: string;
        targetBaseUrl: string;
    }>) => Promise<ProviderCliAttachManagedServiceAccess | null>;
    resolveLaunchSpec?: (
        env?: NodeJS.ProcessEnv,
    ) => AgentCliLaunchSpec | Promise<AgentCliLaunchSpec>;
    resolveCommandInvocation?: (params: Readonly<{
        command: string;
        args: readonly string[];
        env?: NodeJS.ProcessEnv;
    }>) => CommandInvocation;
    spawnProcess?: typeof spawn;
    fetchFn?: typeof fetch;
    probeSocket?: (path: string, timeoutMs: number) => Promise<boolean>;
    env?: NodeJS.ProcessEnv;
    reachabilityTimeoutMs?: number;
}>): AttachSurface {
    const resolveReachability = params.resolveReachability;
    const resolveInvocation = params.resolveCommandInvocation ?? resolveWindowsCommandInvocation;
    const resolveLaunch = async (env: NodeJS.ProcessEnv): Promise<AgentCliLaunchSpec> => await (
        params.resolveLaunchSpec ?? ((processEnv) =>
            requireAgentCliLaunchSpec(params.agentId, { processEnv }))
    )(env);
    const resolveHostFacts = async (
        env: NodeJS.ProcessEnv,
        selectedLaunch?: AgentCliLaunchSpec,
    ): Promise<ProviderCliAttachHostFacts> => {
        if (!params.cliVersionArgs) return Object.freeze({ cliVersion: null });
        const launch = selectedLaunch ?? await resolveLaunch(env);
        return Object.freeze({
            cliVersion: await (params.resolveCliVersion ?? readProviderCliVersion)({
                launch,
                args: params.cliVersionArgs,
                env,
            }),
        });
    };
    const resolveExactManagedServiceAccess = async (
        sessionId: string,
        target: TTarget,
    ): Promise<ProviderCliAttachManagedServiceAccess | null> => {
        const targetBaseUrl = params.managedServiceTargetBaseUrl?.(target);
        if (!targetBaseUrl || !params.resolveManagedServiceAccess) return null;
        try {
            const access = await params.resolveManagedServiceAccess({
                sessionId,
                targetBaseUrl,
            });
            if (!access) return null;
            return new URL(access.baseUrl).toString()
                === new URL(targetBaseUrl).toString()
                ? access
                : null;
        } catch {
            return null;
        }
    };
    return {
        evaluateAvailability: async (request) => {
            const target = await resolveTargetWithFallback({
                metadata: request.metadata,
                sessionId: request.sessionId,
                resolver: params.resolveTarget,
                readFallbackServerBaseUrl: isLocalAttachRequest(request)
                    ? params.readFallbackServerBaseUrl
                    : undefined,
            });
            if (!target.ok) {
                return {
                    available: false,
                    reasonCode: 'missing_metadata',
                    safeMessage: target.reason,
                };
            }
            if (request.depth === 'live') {
                if (!resolveReachability) {
                    return {
                        available: false,
                        reasonCode: 'unsupported',
                        safeMessage: 'Provider attach reachability is unavailable.',
                    };
                }
                const reachability = resolveReachability(
                    target.value,
                    await resolveHostFacts(params.env ?? process.env),
                );
                if (!reachability) {
                    return {
                        available: false,
                        reasonCode: 'missing_metadata',
                        safeMessage: 'Provider attach reachability metadata is invalid.',
                    };
                }

                const timeoutMs = params.reachabilityTimeoutMs ?? 1_500;
                const reachable = reachability.kind === 'localSocket'
                    ? await (params.probeSocket ?? probeLocalSocket)(reachability.path, timeoutMs)
                    : await (async () => {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), timeoutMs);
                        timeout.unref?.();
                        try {
                            const access = await resolveExactManagedServiceAccess(
                                request.sessionId,
                                target.value,
                            );
                            if (access) {
                                const targetUrl = new URL(reachability.url);
                                const accessUrl = new URL(access.baseUrl);
                                if (targetUrl.origin !== accessUrl.origin) return false;
                                return (await access.request({
                                    pathAndQuery: `${targetUrl.pathname}${targetUrl.search}`,
                                    signal: controller.signal,
                                })).ok;
                            }
                            return Boolean((await (params.fetchFn ?? fetch)(reachability.url, {
                                method: 'GET',
                                signal: controller.signal,
                            }).catch(() => null))?.ok);
                        } finally {
                            clearTimeout(timeout);
                        }
                    })();
                if (!reachable) {
                    return {
                        available: false,
                        reasonCode: 'agent_unavailable',
                        retryable: true,
                        safeMessage: 'Provider attach target is unreachable.',
                    };
                }
            }
            return { available: true };
        },
        attach: async ({ metadata, sessionId, signal }) => {
            if (signal?.aborted) {
                return { ok: true, value: { exitCode: 0 } };
            }
            const target = await resolveTargetWithFallback({
                metadata,
                sessionId,
                resolver: params.resolveTarget,
                readFallbackServerBaseUrl: params.readFallbackServerBaseUrl,
            });
            if (!target.ok) {
                return {
                    ok: false,
                    code: 'attach_failed',
                    message: target.reason,
                };
            }

            const env = params.env ?? process.env;
            const managedServiceAccess = await resolveExactManagedServiceAccess(
                sessionId,
                target.value,
            );
            const childEnv = { ...env };
            const credentialEnvironmentKey =
                params.managedServiceCredentialEnvironmentKey;
            const credentialEnvironmentDestinations = credentialEnvironmentKey
                ? [
                    credentialEnvironmentKey,
                    ...(params.managedServiceCredentialEnvironmentAliases ?? []),
                ]
                : [];
            if (managedServiceAccess && credentialEnvironmentKey) {
                for (const environmentKey of credentialEnvironmentDestinations) {
                    delete childEnv[environmentKey];
                }
                const materializedCredential =
                    managedServiceAccess.childEnvironment[credentialEnvironmentKey];
                if (typeof materializedCredential === 'string') {
                    for (const environmentKey of credentialEnvironmentDestinations) {
                        childEnv[environmentKey] = materializedCredential;
                    }
                }
            }
            const launch = await resolveLaunch(childEnv);
            const invocation = resolveInvocation({
                command: launch.command,
                args: [
                    ...launch.args,
                    ...params.createArgs(target.value, await resolveHostFacts(childEnv, launch)),
                ],
                env: childEnv,
            });
            const child = (params.spawnProcess ?? spawn)(
                invocation.command,
                invocation.args,
                {
                    env: childEnv,
                    shell: false,
                    stdio: 'inherit',
                    ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
                },
            ) as unknown as SpawnedAttachProcess;

            const exitCode = await new Promise<number>((resolve) => {
                let stopTimer: NodeJS.Timeout | null = null;
                const finish = (code: number): void => {
                    if (stopTimer) {
                        clearTimeout(stopTimer);
                        stopTimer = null;
                    }
                    signal?.removeEventListener('abort', stop);
                    resolve(code);
                };
                const stop = (): void => {
                    try {
                        child.kill('SIGINT');
                    } catch {
                        logger.infoFile('[provider-attach] Failed to signal foreground attach process', {
                            error: 'provider_attach_cleanup_signal_failed', sessionId, signal: 'SIGINT',
                        });
                        // The exit/error event remains the authoritative settlement.
                    }
                    stopTimer = setTimeout(() => {
                        if (child.exitCode !== null && child.exitCode !== undefined) return;
                        try {
                            child.kill('SIGKILL');
                        } catch {
                            logger.infoFile('[provider-attach] Failed to signal foreground attach process', {
                                error: 'provider_attach_cleanup_signal_failed', sessionId, signal: 'SIGKILL',
                            });
                            // The exit/error event remains the authoritative settlement.
                        }
                    }, PROVIDER_ATTACH_STOP_GRACE_MS);
                    stopTimer.unref?.();
                };
                child.once('error', () => finish(1));
                child.once('exit', (code) => finish(typeof code === 'number' ? code : 1));
                signal?.addEventListener('abort', stop, { once: true });
                if (signal?.aborted) stop();
            });
            return { ok: true, value: { exitCode } };
        },
    };
}
