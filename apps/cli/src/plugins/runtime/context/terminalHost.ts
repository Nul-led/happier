import type {
    AgentSessionHostServices,
} from '@happier-dev/plugin-sdk/agents/runtime';
import { PluginError } from '@happier-dev/plugin-sdk';
import type {
    TerminalHostAdapter,
    TerminalHostHandle,
    TerminalHostPreference,
    TerminalInputInjectionResult,
    TerminalPromptInput,
} from '@happier-dev/agents';
import {
    prepareTerminalPromptTextForInjection,
    resolveTerminalPromptWriteTimeoutMs,
} from '@happier-dev/agents';

import type { CatalogAgentLookupId } from '@/agent/catalog/ids';
import { resolveTerminalHost } from '@/integrations/terminal/host/resolveTerminalHost';
import type { TerminalHostResolution } from '@/integrations/terminal/host/_types';
import { createDefaultTerminalHostAdapterInventory } from '@/integrations/terminal/host/defaultAdapters';
import {
    readTerminalHostAttachmentInfo,
    writeTerminalHostAttachmentInfo,
} from '@/terminal/attachment/terminalAttachmentInfo';
import {
    executeTerminalHostDisposition,
    resolveRuntimeTerminalHostDispositionIntent,
} from '@/terminal/attachment/terminalHostDisposition';
import type { TerminalPromptSubmitVerificationPolicy } from '@/integrations/terminalHost/promptSubmitVerification';
import {
    requireAgentCliLaunchSpec,
    type AgentCliLaunchSpec,
} from '@/packagedRuntime/managedTools/requireAgentCliLaunchSpec';
import { buildScopedProcessEnv } from '@/utils/processEnv/buildScopedProcessEnv';
import { finalizeSessionChildEnvironment } from '@/session/runtime/control/finalizeSessionChildEnvironment';
import { selectTrustedSessionControlEnvironment } from '@/session/runtime/control/sessionControlEnvironment';
import {
    launchBorrowedTerminalProcess,
    type BorrowedTerminalProcess,
} from '@/terminal/host/borrowedTerminalProcess';
import {
    buildActiveTerminalHostHandleFromMetadata,
    resolveExistingTerminalHostLifecycle,
} from '@/terminal/runtime/terminalMetadata';
import type { Metadata } from '@/api/types';
import { logger } from '@/ui/logger';

type AgentTerminalHostService = NonNullable<AgentSessionHostServices['terminalHost']>;
type AgentTerminalHostCreateOrAttachRequest =
    Parameters<AgentTerminalHostService['createOrAttachHost']>[0];
type AgentTerminalHostDisposeIntent = Parameters<AgentTerminalHostService['dispose']>[1];
type AgentTerminalHostLaunchInput = AgentTerminalHostCreateOrAttachRequest['launch'];
type AgentTerminalHostResolveResult = Awaited<ReturnType<AgentTerminalHostService['resolve']>>;
const AGENT_CHILD_LAUNCH_ENVIRONMENT_TRANSFORMERS = new WeakMap<
    AgentTerminalHostService,
    (environment: Readonly<Record<string, string>>) =>
        Readonly<Record<string, string>>
>();

export function installAgentChildLaunchEnvironmentTransformerForTerminalHost(
    service: AgentTerminalHostService,
    transform: (
        environment: Readonly<Record<string, string>>,
    ) => Readonly<Record<string, string>>,
): Readonly<{ dispose(): void }> {
    if (AGENT_CHILD_LAUNCH_ENVIRONMENT_TRANSFORMERS.has(service)) {
        throw new Error(
            'Agent child launch environment transformer is already installed',
        );
    }
    AGENT_CHILD_LAUNCH_ENVIRONMENT_TRANSFORMERS.set(service, transform);
    return Object.freeze({
        dispose() {
            if (
                AGENT_CHILD_LAUNCH_ENVIRONMENT_TRANSFORMERS.get(service)
                === transform
            ) {
                AGENT_CHILD_LAUNCH_ENVIRONMENT_TRANSFORMERS.delete(service);
            }
        },
    });
}

export type PluginTerminalHostErrorCode =
    | 'PLUGIN_TERMINAL_HOST_CAPABILITY_REQUIRED'
    | 'PLUGIN_TERMINAL_HOST_SCOPE_RETIRED'
    | 'PLUGIN_TERMINAL_HOST_UNAVAILABLE'
    | 'PLUGIN_TERMINAL_HOST_UNRESOLVED_LAUNCH'
    | 'PLUGIN_TERMINAL_HOST_HANDLE_NOT_ACTIVE'
    | 'PLUGIN_TERMINAL_HOST_HANDLE_KIND_MISMATCH'
    | 'PLUGIN_TERMINAL_HOST_UNSUPPORTED_LAUNCH';

/**
 * Terminal-host failures reach plugin authors through the Agent session host
 * services, so they ARE canonical PluginErrors. Never assign `name` here -
 * `isPluginError` recognizes the contract by name+data, not by class identity.
 */
export class PluginTerminalHostError extends PluginError {
    constructor(code: PluginTerminalHostErrorCode, message: string) {
        super({ code, message });
    }
}

export type CreatePluginTerminalHostServiceParams = Readonly<{
    hasCapability: (capability: string) => boolean;
    resolveTerminalHost: (preference: TerminalHostPreference) => TerminalHostResolution | Promise<TerminalHostResolution>;
    resolveAgentCliLaunch: (launch: AgentTerminalHostLaunchInput) => Pick<AgentCliLaunchSpec, 'command' | 'args'> & Readonly<{
        env?: Readonly<Record<string, string>>;
    }>;
    resolveCurrentHost?: () => Readonly<{
        handle: TerminalHostHandle;
        lifecycle: 'owned' | 'borrowed';
    }> | null | Promise<Readonly<{
        handle: TerminalHostHandle;
        lifecycle: 'owned' | 'borrowed';
    }> | null>;
    launchCurrentHostProcess?: typeof launchBorrowedTerminalProcess;
    onHostCreated?: (handle: TerminalHostHandle, lifecycle: 'owned' | 'borrowed') => Promise<TerminalHostHandle | void> | TerminalHostHandle | void;
    disposeHost: (input: Readonly<{
        handle: TerminalHostHandle;
        adapter: TerminalHostAdapter;
        intent: AgentTerminalHostDisposeIntent;
        lifecycle: 'owned' | 'borrowed';
    }>) => Promise<void> | void;
}>;

export type CreateDefaultPluginTerminalHostServiceParams = Readonly<{
    happyHomeDir: string;
    hasCapability: (capability: string) => boolean;
    readSessionId?: () => string | null;
    currentTerminalMetadata?: Readonly<Pick<Metadata, 'terminal' | 'startedBy'>>;
    resolvePromptSubmitVerification?: (() => Promise<TerminalPromptSubmitVerificationPolicy | null>) | undefined;
    platform?: NodeJS.Platform;
    arch?: NodeJS.Architecture;
}>;

type ActiveTerminalHost = Readonly<{
    adapter: TerminalHostAdapter;
    handle: TerminalHostHandle;
    lifecycle: 'owned' | 'borrowed';
    currentHostProcess?: BorrowedTerminalProcess;
    currentHostState?: { exited: boolean };
}>;

const TERMINAL_HOST_CAPABILITY = 'terminalHost';

function assertCapability(params: CreatePluginTerminalHostServiceParams): void {
    if (!params.hasCapability(TERMINAL_HOST_CAPABILITY)) {
        throw new PluginTerminalHostError(
            'PLUGIN_TERMINAL_HOST_CAPABILITY_REQUIRED',
            `ctx.terminalHost requires the manifest-derived '${TERMINAL_HOST_CAPABILITY}' runtime capability`,
        );
    }
}

function toPublicResolution(resolution: TerminalHostResolution): AgentTerminalHostResolveResult {
    if (resolution.status === 'disabled') {
        return {
            status: 'disabled',
            reason: resolution.reason,
            message: resolution.message,
        };
    }
    return {
        status: 'resolved',
        hostKind: resolution.adapter.kind,
        reason: resolution.reason,
    };
}

function mergeLaunchEnv(
    hostEnv: Readonly<Record<string, string>> | undefined,
    pluginEnv: AgentTerminalHostLaunchInput['env'],
    unsetEnvKeys: AgentTerminalHostLaunchInput['unsetEnvKeys'],
): Readonly<Record<string, string>> {
    return Object.freeze(finalizeSessionChildEnvironment({
        environment: buildScopedProcessEnv({
            baseEnv: hostEnv ?? {},
            explicitEnv: pluginEnv,
            unsetEnvKeys,
        }),
        canonicalSessionControlEnvironment: selectTrustedSessionControlEnvironment(hostEnv ?? {}),
        enableCgroupSelfMigration: false,
        stackProcessKind: null,
    }) as Record<string, string>);
}

function resolveActiveHost(
    activeHosts: ReadonlyMap<TerminalHostHandle, ActiveTerminalHost>,
    handle: TerminalHostHandle,
): ActiveTerminalHost {
    const active = activeHosts.get(handle);
    if (!active) {
        throw new PluginTerminalHostError(
            'PLUGIN_TERMINAL_HOST_HANDLE_NOT_ACTIVE',
            'ctx.terminalHost received a handle that is not active for this plugin runtime',
        );
    }
    if (active.adapter.kind !== handle.kind) {
        throw new PluginTerminalHostError(
            'PLUGIN_TERMINAL_HOST_HANDLE_KIND_MISMATCH',
            'ctx.terminalHost handle kind does not match the resolved terminal host adapter',
        );
    }
    return active;
}

function handleFields(
    handle: TerminalHostHandle,
): Pick<
    Extract<TerminalInputInjectionResult, { status: 'failed' }>,
    'hostKind' | 'hostSessionName' | 'paneId'
> {
    return {
        hostKind: handle.kind,
        hostSessionName: handle.sessionName,
        ...(handle.paneId ? { paneId: handle.paneId } : {}),
    };
}

function invalidPromptTextResult(
    handle: TerminalHostHandle,
    observedAt: number,
): Extract<TerminalInputInjectionResult, { status: 'failed' }> {
    return {
        status: 'failed',
        reason: 'invalid_prompt_text',
        phase: 'before_write',
        duplicateRisk: 'none',
        recoverable: false,
        observedAt,
        ...handleFields(handle),
    };
}

function preparePromptInputForAdapter(input: TerminalPromptInput): TerminalPromptInput | null {
    const prepared = prepareTerminalPromptTextForInjection(input.text);
    if (!prepared.ok) return null;
    return {
        ...input,
        text: prepared.text,
        multiline: prepared.multiline,
        scheduling: {
            ...input.scheduling,
            timeoutMs: input.scheduling.timeoutMs ?? resolveTerminalPromptWriteTimeoutMs(prepared.text),
        },
    };
}

async function requireResolvedHost(
    params: CreatePluginTerminalHostServiceParams,
    preference: TerminalHostPreference,
): Promise<Extract<TerminalHostResolution, { status: 'resolved' }>> {
    const resolution = await params.resolveTerminalHost(preference);
    if (resolution.status === 'disabled') {
        throw new PluginTerminalHostError(
            'PLUGIN_TERMINAL_HOST_UNAVAILABLE',
            resolution.message,
        );
    }
    return resolution;
}

export function createPluginTerminalHostService(
    params: CreatePluginTerminalHostServiceParams,
): AgentTerminalHostService {
    const activeHosts = new Map<TerminalHostHandle, ActiveTerminalHost>();

    const service: AgentTerminalHostService = Object.freeze({
        async resolve(request: Parameters<AgentTerminalHostService['resolve']>[0]) {
            assertCapability(params);
            const current = await params.resolveCurrentHost?.() ?? null;
            return toPublicResolution(await params.resolveTerminalHost(current?.handle.kind ?? request.preference));
        },
        async createOrAttachHost(request: AgentTerminalHostCreateOrAttachRequest) {
            assertCapability(params);
            if (request.launch.kind !== 'agent-cli') {
                throw new PluginTerminalHostError(
                    'PLUGIN_TERMINAL_HOST_UNSUPPORTED_LAUNCH',
                    'ctx.terminalHost can only launch host-resolved agent CLIs',
                );
            }
            const current = await params.resolveCurrentHost?.() ?? null;
            const resolution = await requireResolvedHost(params, current?.handle.kind ?? request.preference);
            const launch = params.resolveAgentCliLaunch(request.launch);
            if (!launch.command || launch.command.trim().length === 0) {
                throw new PluginTerminalHostError(
                    'PLUGIN_TERMINAL_HOST_UNRESOLVED_LAUNCH',
                    'ctx.terminalHost could not resolve an agent CLI launch command',
                );
            }
            const mergedSpawnEnvironment = mergeLaunchEnv(
                launch.env,
                request.launch.env,
                request.launch.unsetEnvKeys,
            );
            const transform =
                AGENT_CHILD_LAUNCH_ENVIRONMENT_TRANSFORMERS.get(service);
            const spawnArgv = [launch.command, ...launch.args, ...(request.launch.args ?? [])];
            const spawnEnv = transform ? transform(mergedSpawnEnvironment) : mergedSpawnEnvironment;
            const currentHandle = current?.handle ?? null;
            if (currentHandle && currentHandle.kind !== resolution.adapter.kind) {
                throw new PluginTerminalHostError(
                    'PLUGIN_TERMINAL_HOST_HANDLE_KIND_MISMATCH',
                    'Current terminal host kind does not match the resolved terminal host adapter',
                );
            }
            const lifecycle = current?.lifecycle ?? 'owned';
            if (currentHandle) await resolution.adapter.validateExistingHostAdmission?.(currentHandle);
            const currentHostProcess = currentHandle
                ? await (params.launchCurrentHostProcess ?? launchBorrowedTerminalProcess)({
                    spawnArgv,
                    workingDirectory: request.workingDirectory,
                    spawnEnv,
                })
                : undefined;
            const createdHandle = currentHandle ?? await resolution.adapter.createOrAttachHost({
                sessionName: request.sessionName,
                ...(request.label !== undefined ? { label: request.label } : {}),
                workingDirectory: request.workingDirectory,
                spawnArgv,
                spawnEnv,
                ...(request.launch.unsetEnvKeys
                    ? { unsetEnvKeys: request.launch.unsetEnvKeys }
                    : {}),
                isolatedEnv: request.isolatedEnv,
            });
            let handle = createdHandle;
            try {
                handle = await params.onHostCreated?.(createdHandle, lifecycle) ?? createdHandle;
            } catch (error) {
                try {
                    if (currentHostProcess) await currentHostProcess.terminate();
                    else await resolution.adapter.dispose(createdHandle);
                } catch (cleanupError) {
                    // Never serialize causes: launch/persistence failures can contain private inputs.
                    logger.warn('[terminal-host] Binding failed and launch rollback could not be confirmed', {
                        hostKind: createdHandle.kind,
                        lifecycle,
                    });
                    throw new AggregateError(
                        [error, cleanupError],
                        'Terminal-host binding and launch rollback failed. Inspect the terminal host before retrying.',
                        { cause: error },
                    );
                }
                throw error;
            }
            const currentHostState = currentHostProcess ? { exited: false } : undefined;
            if (currentHostProcess && currentHostState) {
                void currentHostProcess.whenExited.then(
                    () => { currentHostState.exited = true; },
                    () => { currentHostState.exited = true; },
                );
            }
            activeHosts.set(handle, {
                adapter: resolution.adapter,
                handle,
                lifecycle,
                ...(currentHostProcess ? { currentHostProcess, currentHostState } : {}),
            });
            return handle;
        },
        async injectUserPrompt(
            handle: Parameters<AgentTerminalHostService['injectUserPrompt']>[0],
            input: Parameters<AgentTerminalHostService['injectUserPrompt']>[1],
        ) {
            const active = resolveActiveHost(activeHosts, handle);
            const preparedInput = preparePromptInputForAdapter(input);
            if (preparedInput === null) {
                return invalidPromptTextResult(active.handle, Date.now());
            }
            return active.adapter.injectUserPrompt(active.handle, preparedInput);
        },
        async interruptTurn(handle: Parameters<AgentTerminalHostService['interruptTurn']>[0]) {
            const active = resolveActiveHost(activeHosts, handle);
            await active.adapter.interruptTurn(active.handle);
        },
        async evaluateLiveness(handle: Parameters<AgentTerminalHostService['evaluateLiveness']>[0]) {
            const active = resolveActiveHost(activeHosts, handle);
            if (active.currentHostState?.exited) {
                return { paneAlive: false, paneDead: true, observedAt: Date.now() };
            }
            return active.adapter.evaluateLiveness(active.handle);
        },
        async captureInputState(handle: Parameters<AgentTerminalHostService['captureInputState']>[0]) {
            const active = resolveActiveHost(activeHosts, handle);
            if (!active.adapter.captureInputState) return null;
            return active.adapter.captureInputState(active.handle);
        },
        async controlPort(handle: Parameters<AgentTerminalHostService['controlPort']>[0]) {
            const active = resolveActiveHost(activeHosts, handle);
            if (!active.adapter.createControlPort) return null;
            return active.adapter.createControlPort(active.handle);
        },
        async dispose(
            handle: Parameters<AgentTerminalHostService['dispose']>[0],
            intent: Parameters<AgentTerminalHostService['dispose']>[1],
        ) {
            const active = resolveActiveHost(activeHosts, handle);
            await active.currentHostProcess?.terminate();
            await params.disposeHost({
                handle: active.handle,
                adapter: active.adapter,
                intent,
                lifecycle: active.lifecycle,
            });
            activeHosts.delete(handle);
        },
    });
    return service;
}

async function resolveDefaultTerminalHost(
    params: CreateDefaultPluginTerminalHostServiceParams,
    preference: TerminalHostPreference,
): Promise<TerminalHostResolution> {
    const platform = params.platform ?? process.platform;
    const promptSubmitVerification = await params.resolvePromptSubmitVerification?.() ?? null;
    const sessionId = params.readSessionId?.()?.trim() ?? '';
    const savedAttachment = preference === 'herdr' && sessionId
        ? await readTerminalHostAttachmentInfo({ happyHomeDir: params.happyHomeDir, sessionId })
        : null;
    const savedHerdrSessionName = savedAttachment && savedAttachment.version !== 1 && savedAttachment.handle.kind === 'herdr'
        ? savedAttachment.handle.sessionName
        : undefined;
    const inventory = await createDefaultTerminalHostAdapterInventory({
        happyHomeDir: params.happyHomeDir,
        preference,
        platform,
        ...(savedHerdrSessionName ? { herdrSessionName: savedHerdrSessionName } : {}),
        ...(promptSubmitVerification ? { promptSubmitVerification } : {}),
    });

    return resolveTerminalHost({
        preference,
        platform: {
            os: platform,
            arch: params.arch ?? process.arch,
        },
        adapters: inventory.adapters,
        tmuxAvailable: inventory.tmuxAvailable,
        zellijAvailable: inventory.zellijAvailable,
    });
}

function buildProviderCliProcessEnv(input: AgentTerminalHostLaunchInput): NodeJS.ProcessEnv {
    return buildScopedProcessEnv({
        baseEnv: process.env,
        explicitEnv: input.env,
        unsetEnvKeys: input.unsetEnvKeys,
    });
}

export function createDefaultPluginTerminalHostService(
    params: CreateDefaultPluginTerminalHostServiceParams,
): AgentTerminalHostService {
    return createPluginTerminalHostService({
        hasCapability: params.hasCapability,
        resolveTerminalHost: (preference) => resolveDefaultTerminalHost(params, preference),
        resolveAgentCliLaunch: (launch) => requireAgentCliLaunchSpec(launch.agentId as CatalogAgentLookupId, {
            processEnv: buildProviderCliProcessEnv(launch),
        }),
        resolveCurrentHost: async () => {
            const metadata = params.currentTerminalMetadata;
            const handle = metadata?.terminal
                ? buildActiveTerminalHostHandleFromMetadata(metadata.terminal)
                : null;
            if (!handle) return null;
            const sessionId = params.readSessionId?.()?.trim() ?? '';
            const attachmentInfo = sessionId
                ? await readTerminalHostAttachmentInfo({ happyHomeDir: params.happyHomeDir, sessionId })
                : null;
            return {
                handle,
                lifecycle: resolveExistingTerminalHostLifecycle(metadata, attachmentInfo) ?? 'owned',
            };
        },
        onHostCreated: async (handle, lifecycle) => {
            const sessionId = params.readSessionId?.()?.trim() ?? '';
            if (!sessionId) return;
            const attachmentInfo = await writeTerminalHostAttachmentInfo({
                happyHomeDir: params.happyHomeDir,
                sessionId,
                handle,
                lifecycle,
            });
            return attachmentInfo.handle;
        },
        disposeHost: async ({ handle, adapter, intent, lifecycle }) => {
            const sessionId = params.readSessionId?.()?.trim() ?? '';
            const attachmentId = handle.attachmentId;
            const mustDestroyExactHost = intent.kind === 'destroy_owned_host';
            if (!sessionId || !attachmentId) {
                if (mustDestroyExactHost) {
                    throw new Error('Exact terminal-host disposal requires persisted session and attachment identity');
                }
                return;
            }
            const attachmentInfo = await readTerminalHostAttachmentInfo({
                happyHomeDir: params.happyHomeDir,
                sessionId,
            });
            if (!attachmentInfo || attachmentInfo.version === 1 || attachmentInfo.attachmentId !== attachmentId) {
                if (mustDestroyExactHost) {
                    throw new Error('Exact terminal-host disposal could not confirm the current attachment identity');
                }
                return;
            }
            const disposition = await executeTerminalHostDisposition({
                happyHomeDir: params.happyHomeDir,
                sessionId,
                expectedAttachmentId: attachmentId,
                intent: lifecycle === 'borrowed'
                    ? { kind: 'release_borrowed_host', reason: intent.kind === 'destroy_owned_host' ? 'explicit_user_stop' : 'wrapper_exit' }
                    : resolveRuntimeTerminalHostDispositionIntent(intent),
                adapter,
            });
            const expectedStatus = lifecycle === 'borrowed' ? 'retired' : 'destroyed';
            if ((mustDestroyExactHost || lifecycle === 'borrowed') && disposition.status !== expectedStatus) {
                const failure = disposition.status === 'parked' ? disposition.reason : disposition.status;
                throw new Error(`Exact terminal-host disposal did not complete: ${failure}`);
            }
        },
    });
}
