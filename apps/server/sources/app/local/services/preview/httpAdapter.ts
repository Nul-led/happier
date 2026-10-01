import { proxyLocalServicePreviewHttpRequest as proxyShared, type ProxyLocalServicePreviewHttpRequestInput as SharedInput } from "@happier-dev/peer-mediation/localServices/preview/httpAdapter";
import { createPeerMediationFlowEvent, createPeerMediationHttpRequestFinishedEvent, createPeerMediationHttpRequestStartedEvent, createPeerMediationHttpRequestAbortedEvent, type PeerMediationObservabilityEmitter } from "@/app/api/socket/peer/mediation/observability/events";
import { log } from "@/utils/logging/log";
export * from "@happier-dev/peer-mediation/localServices/preview/httpAdapter";
export type ProxyLocalServicePreviewHttpRequestInput = Omit<SharedInput, "observability"> & Readonly<{ observability?: PeerMediationObservabilityEmitter }>;
export async function proxyLocalServicePreviewHttpRequest(input: ProxyLocalServicePreviewHttpRequestInput) {
    const observability = input.observability;
    return await proxyShared({
        ...input,
        onTransportUnavailable: (event) => log(event, `Local service preview tunnel unavailable: ${event.reasonCode}`),
        observability: observability ? {
            createPeerMediationFlowEvent: (event) => observability.emit(createPeerMediationFlowEvent(event)),
            createPeerMediationHttpRequestFinishedEvent: (event) => observability.emit(createPeerMediationHttpRequestFinishedEvent(event)),
            createPeerMediationHttpRequestStartedEvent: (event) => observability.emit(createPeerMediationHttpRequestStartedEvent(event)),
            createPeerMediationHttpRequestAbortedEvent: (event) => observability.emit(createPeerMediationHttpRequestAbortedEvent(event)),
        } : undefined,
    });
}
