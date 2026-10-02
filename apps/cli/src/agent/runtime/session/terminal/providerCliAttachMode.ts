import type { ApiSessionClient } from '@/api/session/sessionClient';
import type { HostTerminalOrchestration } from './contract';
import { createTerminalRuntimeSwitchHandlerService } from './switchHandler';
import type { HostSessionTerminalRemoteModeLoop } from '@/agent/runtime/session/loop/terminalRemoteModeRuntime';
import type { RuntimeTurnOperations, RuntimeTurnDisposeReason, RuntimeTurnSessionOpenIntent } from '@/agent/runtime/turns/runtimeTurnOperations';
import { createAgentRuntimeSwitchState } from '@/agent/runtime/mode/switching/createSwitchState';
import type { HostProviderCliAttachSurface, HostProviderCliAttachRequest } from '@/session/attach/providerCliAttach';
import { logger } from '@/ui/logger';

export function waitForNativeAgentTerminalRemoteDisposition(params: Readonly<{
    signal: AbortSignal;
    switching: HostTerminalOrchestration['switching'] | null;
    requestLocal?: () => Promise<boolean>;
}>): Promise<'switch' | 'exit'> {
    if (params.signal.aborted) return Promise.resolve('exit');
    if (!params.switching) {
        return new Promise((resolve) => {
            params.signal.addEventListener(
                'abort',
                () => resolve('exit'),
                { once: true },
            );
        });
    }
    const switching = params.switching;
    return new Promise((resolve, reject) => {
        let settled = false;
        let subscription: ReturnType<
            HostTerminalOrchestration['switching']['register']
        > | null = null;
        const settle = (result: 'switch' | 'exit') => {
            if (settled) return;
            settled = true;
            params.signal.removeEventListener('abort', onAbort);
            subscription?.unsubscribe();
            subscription = null;
            resolve(result);
        };
        const onAbort = () => settle('exit');
        try {
            subscription = switching.register(async (request) => {
                if (request.target === 'remote') return true;
                if (request.target !== 'local') return false;
                const receipt = params.requestLocal?.();
                settle('switch');
                return receipt ? await receipt : true;
            });
        } catch (error) {
            reject(error);
            return;
        }
        params.signal.addEventListener('abort', onAbort, { once: true });
        if (params.signal.aborted) settle('exit');
    });
}

export function createNativeAgentProviderAttachModeBinding<TRuntime extends RuntimeTurnOperations>(params: Readonly<{
    runtime: TRuntime;
    attach: HostProviderCliAttachSurface;
    session: ApiSessionClient;
    topology: 'exclusive' | 'shared';
    remoteWritable: boolean;
    startingMode: 'terminal' | 'remote';
    generationSignal?: AbortSignal;
    resolveManagedServiceAccess?: HostProviderCliAttachRequest['resolveManagedServiceAccess'];
    hostPresentation?: HostProviderCliAttachRequest['hostPresentation'];
    disposePresentation?(): Promise<void>;
    readPresentationAttachmentId?(): string | undefined;
}>): Readonly<{
    runtime: TRuntime;
    terminalRemoteModeLoop: HostSessionTerminalRemoteModeLoop;
}> {
    const prepareTerminalPresentation = params.runtime.prepareTerminalPresentation;
    if (!prepareTerminalPresentation) {
        throw new Error('Provider CLI attach preparation is unavailable');
    }
    const lifecycleAbortController = new AbortController();
    let activeAttach: Promise<unknown> | null = null;
    const lifecycleSignal = AbortSignal.any([
        lifecycleAbortController.signal,
        ...(params.generationSignal ? [params.generationSignal] : []),
    ]);
    const switching = createTerminalRuntimeSwitchHandlerService({
        registerHandler: params.session.rpcHandlerManager.registerHandler.bind(
            params.session.rpcHandlerManager,
        ),
    });
    let pendingLocalRestore: Readonly<{ promise: Promise<boolean>; complete(value: boolean): void }> | null = null;
    const beginLocalRestore = () => {
        if (pendingLocalRestore) return pendingLocalRestore;
        let complete!: (value: boolean) => void;
        const promise = new Promise<boolean>((resolve) => { complete = resolve; });
        pendingLocalRestore = { promise, complete };
        return pendingLocalRestore;
    };
    const completeLocalRestore = (value: boolean) => {
        pendingLocalRestore?.complete(value);
        pendingLocalRestore = null;
    };
    lifecycleSignal.addEventListener('abort', () => completeLocalRestore(false), { once: true });
    const publishAttached = async (attached: boolean): Promise<void> => {
        const expectedAttachmentId = params.readPresentationAttachmentId?.();
        if (!attached && expectedAttachmentId
            && params.session.getMetadataSnapshot()?.terminal?.controlServiceabilityV1?.attachmentId !== expectedAttachmentId) return;
        await params.session.updateAgentState((current) => ({
            ...current,
            controlledByUser: false,
            localControl: createAgentRuntimeSwitchState({
                attached,
                topology: params.topology,
                canAttach: true,
                canDetach: attached,
                remoteWritable: params.remoteWritable,
            }),
        }));
    };
    const modeLoop: HostSessionTerminalRemoteModeLoop = Object.freeze({
        startingMode: params.startingMode,
        remoteExitCode: 0,
        topology: params.topology,
        remoteWritable: params.remoteWritable,
        ownsCurrentTerminalDisplay: true,
        async runTerminal() {
            const receipt = beginLocalRestore();
            let attached = false;
            const localAbortController = new AbortController();
            const signal = AbortSignal.any([
                lifecycleSignal,
                localAbortController.signal,
            ]);
            const switchBinding = switching.register(async (request) => {
                if (request.target === 'local') return attached ? true : await receipt.promise;
                if (request.target !== 'remote') return false;
                completeLocalRestore(false);
                localAbortController.abort();
                return true;
            });
            try {
                const presentation = await prepareTerminalPresentation();
                if (presentation.kind !== 'provider_attach') {
                    throw new Error('The active Session does not prepare a provider CLI attachment');
                }
                if (signal.aborted) {
                    return lifecycleSignal.aborted
                        ? { type: 'exit' as const, code: 0 }
                        : { type: 'switch' as const };
                }
                const attaching = params.attach.attachManaged({
                    sessionId: params.session.sessionId,
                    metadata: presentation.metadata,
                    signal,
                    ...(params.hostPresentation ? { hostPresentation: params.hostPresentation } : {}),
                    ...(params.resolveManagedServiceAccess
                        ? { resolveManagedServiceAccess: params.resolveManagedServiceAccess }
                        : {}),
                    onAttached: async () => {
                        signal.throwIfAborted();
                        await publishAttached(true);
                        signal.throwIfAborted();
                        attached = true;
                        completeLocalRestore(true);
                    },
                });
                activeAttach = Promise.resolve(attaching);
                const result = await attaching;
                if (!result.ok) {
                    throw new Error(result.message);
                }
                if (!attached && !signal.aborted) {
                    throw new Error('Managed provider attach ended before native startup');
                }
                return lifecycleSignal.aborted
                    ? { type: 'exit' as const, code: result.value.exitCode ?? 0 }
                    : { type: 'switch' as const };
            } catch (error) {
                if (lifecycleSignal.aborted) return { type: 'exit' as const, code: 0 };
                if (localAbortController.signal.aborted) return { type: 'switch' as const };
                // The Session runtime is already admitted. A missing optional client
                // must leave the same remote Session usable, including initial presentation.
                logger.infoFile('[native-agent] Managed terminal restoration failed; retaining remote Session', {
                    error: 'managed_provider_attach_startup_failed', sessionId: params.session.sessionId,
                });
                return { type: 'switch' as const };
            } finally {
                activeAttach = null;
                completeLocalRestore(false);
                switchBinding.unsubscribe();
                await publishAttached(false);
            }
        },
        async runRemote() {
            await publishAttached(false);
            return await waitForNativeAgentTerminalRemoteDisposition({
                signal: lifecycleSignal,
                switching,
                requestLocal: () => beginLocalRestore().promise,
            });
        },
        onModeChange: () => undefined,
    });
    const runtime = Object.freeze({
        ...params.runtime,
        async resetOrDisposeRuntime(
            reason?: RuntimeTurnDisposeReason,
            nextSessionOpenIntent?: RuntimeTurnSessionOpenIntent,
        ) {
            lifecycleAbortController.abort();
            await activeAttach;
            await params.disposePresentation?.();
            await params.runtime.resetOrDisposeRuntime(
                reason,
                nextSessionOpenIntent,
            );
        },
    });
    return Object.freeze({ runtime, terminalRemoteModeLoop: modeLoop });
}
