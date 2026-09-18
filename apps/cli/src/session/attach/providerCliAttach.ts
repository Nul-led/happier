import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createConnection } from 'node:net';

import { resolveWindowsCommandInvocation, type CommandInvocation } from '@happier-dev/cli-common/process';
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

type SpawnedAttachProcess = Readonly<{
    once: {
        (event: 'exit', handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
        (event: 'error', handler: (error: Error) => void): void;
    };
}>;

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
    createArgs: (target: TTarget) => readonly string[];
    resolveReachability?: (target: TTarget) => AgentProviderCliAttachReachabilityV1 | null;
    readFallbackServerBaseUrl?: (
        input: Readonly<{ sessionId: string }>,
    ) => Promise<string | null>;
    resolveLaunchSpec?: (env?: NodeJS.ProcessEnv) => AgentCliLaunchSpec;
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
                const reachability = resolveReachability(target.value);
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
        attach: async ({ metadata, sessionId }) => {
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
            const launch = (params.resolveLaunchSpec ?? ((processEnv) =>
                requireAgentCliLaunchSpec(params.agentId, { processEnv })))(env);
            const invocation = resolveInvocation({
                command: launch.command,
                args: [
                    ...launch.args,
                    ...params.createArgs(target.value),
                ],
                env,
            });
            const child = (params.spawnProcess ?? spawn)(
                invocation.command,
                invocation.args,
                {
                    env,
                    shell: false,
                    stdio: 'inherit',
                    ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
                },
            ) as unknown as SpawnedAttachProcess;

            const exitCode = await new Promise<number>((resolve) => {
                child.once('error', () => resolve(1));
                child.once('exit', (code) => resolve(typeof code === 'number' ? code : 1));
            });
            return { ok: true, value: { exitCode } };
        },
    };
}
