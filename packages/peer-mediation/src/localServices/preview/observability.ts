type PreviewObservation = Readonly<{
    accountId: string; machineId: string; previewId: string; tunnelId: string;
    substreamId: string; url: string; nowMs: number;
}>;
type HttpObservation = PreviewObservation & Readonly<{ requestId: string; method: string }>;
type Headers = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Host adapters retain event redaction, event construction, logging and delivery. */
export interface PreviewAdapterObservability {
    createPeerMediationHttpRequestStartedEvent?: (input: HttpObservation & Readonly<{ headers: Headers }>) => void;
    createPeerMediationHttpRequestFinishedEvent?: (input: HttpObservation & Readonly<{ statusCode: number; responseBytes: number; durationMs: number }>) => void;
    createPeerMediationHttpRequestAbortedEvent?: (input: HttpObservation & Readonly<{ reasonCode: string; durationMs: number }>) => void;
    createPeerMediationFlowEvent?: (input: Readonly<{
        accountId: string; machineId: string; flowKind: 'tcp_tunnel'; flowId: string;
        kind: 'flow.errored'; reasonCode: string; nowMs: number; metadata: Readonly<{ requestId: string }>;
    }>) => void;
    createPeerMediationWebSocketEvent?: (input: PreviewObservation & Readonly<{
        kind: 'websocket.opened' | 'websocket.closed' | 'websocket.aborted' | 'websocket.errored';
        socketId: string; headers: Headers; durationMs?: number; reasonCode?: string;
    }>) => void;
}
