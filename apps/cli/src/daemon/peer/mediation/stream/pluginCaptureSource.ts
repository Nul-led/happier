import type { PluginContributionIdentityV1 } from '@happier-dev/protocol';
import type { ResolvedExecutablePluginRuntimeRegistry } from '@/plugins/runtime/resolveExecutablePluginRuntimeRegistry';
import type { MachineLiveStreamCaptureRegistry, MachineLiveStreamRegisteredCaptureSource } from './captureRegistry';

/** Adapts activation's exact manifest-backed runtime into the existing capture owner. */
export async function registerPluginCaptureSource(input: Readonly<{
    runtimeRegistry: ResolvedExecutablePluginRuntimeRegistry;
    captureRegistry: MachineLiveStreamCaptureRegistry;
    reference: PluginContributionIdentityV1;
}>): Promise<MachineLiveStreamRegisteredCaptureSource | null> {
    const lease = await input.runtimeRegistry.resolveCaptureSource(input.reference);
    if (!lease?.isCurrent()) return null;
    const sourceId = `plugin:${input.reference.pluginId}/${input.reference.localId}`;
    const existing = input.captureRegistry.resolve({ sourceId });
    if (existing.ok && existing.source.plugin?.occurrenceId === lease.occurrenceId
        && !existing.source.retirementSignal?.aborted) return existing.source;
    input.captureRegistry.register({
        sourceId, streamFamily: lease.declaration.streamFamily,
        plugin: { ...input.reference, occurrenceId: lease.occurrenceId },
        retirementSignal: lease.retirementSignal,
        capabilities: { v: 1, sourceId, sourceKind: 'plugin', displayName: lease.declaration.displayName,
            supportedCodecs: lease.declaration.supportedCodecs, inputMode: 'none', sidebands: [], health: { status: 'available' } },
        adapter: { async start(start) {
            if (!lease.isCurrent()) return { ok: false, reasonCode: 'capture_source_unavailable' };
            const controller = new AbortController();
            let session: Awaited<ReturnType<typeof lease.runtime.start>> | null = null;
            let stopping: Promise<void> | null = null;
            const stop = async () => {
                controller.abort();
                lease.retirementSignal.removeEventListener('abort', retire);
                if (session && !stopping) stopping = Promise.resolve(session.stop());
                await stopping;
            };
            const retire = () => { void stop().catch(() => undefined); };
            lease.retirementSignal.addEventListener('abort', retire, { once: true });
            try {
                session = await lease.runtime.start({ streamId: start.streamId, signal: controller.signal,
                    offerFrame: frame => controller.signal.aborted || !lease.isCurrent()
                        ? { ok: false, reasonCode: 'capture_source_unavailable' }
                        : start.offerFrame({ ...frame, streamId: start.streamId }),
                    emitReceipt: receipt => { if (!controller.signal.aborted && lease.isCurrent()) start.emitReceipt({ ...receipt, streamId: start.streamId }); },
                });
                if (!lease.isCurrent() || controller.signal.aborted) {
                    await stop();
                    return { ok: false, reasonCode: 'capture_source_unavailable' };
                }
                return { ok: true, session: { stop } };
            } catch {
                await stop();
                return { ok: false, reasonCode: 'capture_source_unavailable' };
            }
        } },
    });
    const resolved = input.captureRegistry.resolve({ sourceId });
    return resolved.ok ? resolved.source : null;
}
