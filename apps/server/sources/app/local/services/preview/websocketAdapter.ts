import { proxyLocalServicePreviewWebSocketUpgrade as proxyShared, type ProxyLocalServicePreviewWebSocketUpgradeInput as SharedInput } from "@happier-dev/peer-mediation/localServices/preview/websocketAdapter";
import { createPeerMediationWebSocketEvent, type PeerMediationObservabilityEmitter } from "@/app/api/socket/peer/mediation/observability/events";
export * from "@happier-dev/peer-mediation/localServices/preview/websocketAdapter";
export type ProxyLocalServicePreviewWebSocketUpgradeInput = Omit<SharedInput, "observability"> & Readonly<{ observability?: PeerMediationObservabilityEmitter }>;
export async function proxyLocalServicePreviewWebSocketUpgrade(input: ProxyLocalServicePreviewWebSocketUpgradeInput) {
    const observability = input.observability;
    return await proxyShared({
        ...input,
        observability: observability ? {
            createPeerMediationWebSocketEvent: (event) => observability.emit(createPeerMediationWebSocketEvent(event)),
        } : undefined,
    });
}
