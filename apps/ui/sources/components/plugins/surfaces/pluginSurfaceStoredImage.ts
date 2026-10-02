import { SessionImageMediaReferenceV1Schema, type SessionImageMediaReferenceV1,
    DaemonPluginStoredImageReadRequestSchema, DaemonPluginStoredImageReadResponseSchema,
    type DaemonPluginStoredImageReadRequest, type DaemonPluginStoredImageReadResponse } from '@happier-dev/protocol';
import { PluginUiReadStoredImageRequestV1Schema, type PluginUiJsonValueV1 } from '@happier-dev/protocol/plugins/ui';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import { mergeAbortSignals } from '@/utils/runtime/abortSignals';
import { createPluginSurfaceHostApiError, type PluginSurfaceHostApiMethodHandler } from './createPluginSurfaceHostApi';

export type PluginStoredImageReadTransport = (machineId: string, request: DaemonPluginStoredImageReadRequest,
    options: Readonly<{ serverId: string | null; signal?: AbortSignal }>) => Promise<DaemonPluginStoredImageReadResponse>;
const readStoredImage: PluginStoredImageReadTransport = async (machineId, request, options) => {
    const result = await machineRpcWithServerScope<unknown, unknown>({
        machineId, serverId: options.serverId, method: RPC_METHODS.DAEMON_PLUGIN_STORED_IMAGE_READ,
        payload: DaemonPluginStoredImageReadRequestSchema.parse(request), ...(options.signal ? { signal: options.signal } : {}),
    });
    return DaemonPluginStoredImageReadResponseSchema.parse(result);
};

/** Exact delivered native references retained by one mount; the daemon owns Session read authorization. */
export function createPluginSurfaceStoredImageOwner(input: Readonly<{
    pluginId: string; occurrenceId: string; machineId: string; serverId: string | null;
    isCurrent(): boolean; lifetimeSignal: AbortSignal; read?: PluginStoredImageReadTransport;
}>): Readonly<{
    retainActionResult(result: PluginUiJsonValueV1): void;
    readStoredImage: PluginSurfaceHostApiMethodHandler;
    dispose(): void;
}> {
    const mediaByKey = new Map<string, SessionImageMediaReferenceV1 & { file: NonNullable<SessionImageMediaReferenceV1['file']> }>();
    let disposed = false;
    const current = () => !disposed && !input.lifetimeSignal.aborted && input.isCurrent();
    const retain = (value: PluginUiJsonValueV1): void => {
        if (!value || typeof value !== 'object') return;
        const media = SessionImageMediaReferenceV1Schema.required({ file: true }).safeParse(value);
        if (media.success) {
            mediaByKey.set(JSON.stringify([media.data.file.sessionId, media.data.mediaId]), media.data);
            return;
        }
        for (const child of Array.isArray(value) ? value : Object.values(value)) retain(child);
    };
    return {
        retainActionResult(result) {
            if (!current()) return;
            retain(result);
        },
        async readStoredImage(request, options) {
            if (!current()) return createPluginSurfaceHostApiError('stale_surface', ['plugin_surface_retired']);
            const parsed = PluginUiReadStoredImageRequestV1Schema.safeParse(request.payload);
            if (!parsed.success) return createPluginSurfaceHostApiError('invalid_payload', ['stored_image_reference_invalid']);
            const media = mediaByKey.get(JSON.stringify([parsed.data.image.sessionId, parsed.data.image.mediaId]));
            if (!media) return createPluginSurfaceHostApiError('unavailable', ['plugin_session_media_not_retained']);
            const merged = mergeAbortSignals([input.lifetimeSignal, options?.signal]);
            const signal = merged.signal;
            try {
                if (signal?.aborted) return createPluginSurfaceHostApiError('unavailable', ['aborted']);
                const result = await (input.read ?? readStoredImage)(input.machineId, {
                    callerPluginId: input.pluginId, expectedCallerOccurrenceId: input.occurrenceId, media,
                }, { serverId: input.serverId, ...(signal ? { signal } : {}) });
                if (!current()) return createPluginSurfaceHostApiError('stale_surface', ['plugin_surface_retired']);
                if (signal?.aborted) return createPluginSurfaceHostApiError('unavailable', ['aborted']);
                return result.ok ? result.image : createPluginSurfaceHostApiError('unavailable', [result.code]);
            } catch {
                return createPluginSurfaceHostApiError('unavailable', ['plugin_session_media_unavailable']);
            } finally {
                merged.dispose();
            }
        },
        dispose() { disposed = true; mediaByKey.clear(); },
    };
}
