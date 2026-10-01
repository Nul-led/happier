import { PluginError } from '@happier-dev/plugin-sdk';

import type { ActivatedPluginRuntimeRegistry } from '../lifecycle/manager';
import type { PluginRuntimeOccurrenceId } from '../runtimeSlots';
import type { PluginSourceCustody } from '../sourceAuthority';

type PluginRuntimeConsumerLifecycle = Readonly<{
    controller: AbortController;
    isCurrent(): boolean;
    retirementSignal: AbortSignal;
}>;

type PluginRuntimeConsumerAssembly = Readonly<{
    allRetirementSignal: AbortSignal;
    isOccurrenceCurrent(): boolean;
    isPluginRetired(pluginId: string): boolean;
    resolveLifecycle(pluginId: string): PluginRuntimeConsumerLifecycle;
    isPluginCurrent(pluginId: string): boolean;
    readPluginOccurrenceId(pluginId: string): PluginRuntimeOccurrenceId | null;
    isPluginOccurrenceCurrent(
        pluginId: string,
        occurrenceId: PluginRuntimeOccurrenceId,
    ): boolean;
    readPluginSourceCustody(pluginId: string): PluginSourceCustody | null;
    composeSignal(pluginId: string, callerSignal?: AbortSignal): AbortSignal;
    fencePlugins(pluginIds: readonly string[]): void;
    retirePlugins(pluginIds: readonly string[]): Promise<void>;
    retireAll(reason: unknown): void;
}>;

export function assemblePluginRuntimeConsumers(input: Readonly<{
    activatedRegistry: ActivatedPluginRuntimeRegistry;
    onFencePlugin(pluginId: string): void;
    retirePluginDatabases(pluginIds: readonly string[]): Promise<void>;
}>): PluginRuntimeConsumerAssembly {
    let allRetired = false;
    const retiredPluginIds = new Set<string>();
    const allRetirement = new AbortController();
    const lifecycles = new Map<string, PluginRuntimeConsumerLifecycle>();
    const createRetiredError = (pluginId: string): PluginError => new PluginError({
        code: 'plugin_generation_stale',
        message: `Plugin runtime generation '${pluginId}' retired`,
    });
    const resolveLifecycle = (pluginId: string) => {
        const existing = lifecycles.get(pluginId);
        if (existing) return existing;
        const controller = new AbortController();
        const lifecycle = Object.freeze({
            controller,
            isCurrent: () => !allRetired && !retiredPluginIds.has(pluginId),
            retirementSignal: controller.signal,
        });
        lifecycles.set(pluginId, lifecycle);
        if (allRetired || retiredPluginIds.has(pluginId)) {
            controller.abort(createRetiredError(pluginId));
        }
        return lifecycle;
    };
    const isPluginCurrent = (pluginId: string): boolean => resolveLifecycle(pluginId).isCurrent();
    const fencePlugins = (pluginIds: readonly string[]): void => {
        const newlyRetired = [...new Set(pluginIds)].filter(
            (pluginId) => !retiredPluginIds.has(pluginId),
        );
        if (newlyRetired.length === 0) return;
        input.activatedRegistry.retireBackgroundServices(newlyRetired);
        for (const pluginId of newlyRetired) {
            input.onFencePlugin(pluginId);
            retiredPluginIds.add(pluginId);
            const lifecycle = resolveLifecycle(pluginId);
            if (!lifecycle.controller.signal.aborted) {
                lifecycle.controller.abort(createRetiredError(pluginId));
            }
        }
    };
    const retirePlugins = async (pluginIds: readonly string[]): Promise<void> => {
        fencePlugins(pluginIds);
        await input.retirePluginDatabases(pluginIds);
    };
    return Object.freeze({
        allRetirementSignal: allRetirement.signal,
        isOccurrenceCurrent: (): boolean => !allRetired,
        isPluginRetired: (pluginId: string): boolean => retiredPluginIds.has(pluginId),
        resolveLifecycle,
        isPluginCurrent,
        readPluginOccurrenceId: (pluginId: string) => (
            isPluginCurrent(pluginId)
                ? input.activatedRegistry.readPluginOccurrenceId(pluginId)
                : null
        ),
        isPluginOccurrenceCurrent: (
            pluginId: string,
            occurrenceId: PluginRuntimeOccurrenceId,
        ): boolean => (
            isPluginCurrent(pluginId)
            && input.activatedRegistry.isPluginOccurrenceCurrent(pluginId, occurrenceId)
        ),
        readPluginSourceCustody: (pluginId: string) => (
            isPluginCurrent(pluginId)
                ? input.activatedRegistry.readPluginSourceCustody(pluginId)
                : null
        ),
        composeSignal(pluginId: string, callerSignal?: AbortSignal): AbortSignal {
            const retirementSignal = resolveLifecycle(pluginId).retirementSignal;
            return callerSignal
                ? AbortSignal.any([callerSignal, retirementSignal])
                : retirementSignal;
        },
        fencePlugins,
        retirePlugins,
        retireAll(reason: unknown): void {
            if (allRetired) return;
            allRetired = true;
            for (const pluginId of lifecycles.keys()) {
                void retirePlugins([pluginId]).catch(() => undefined);
            }
            allRetirement.abort(reason);
        },
    });
}
