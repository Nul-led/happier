/** Substream multiplexer over one tunnel carrier. */
import {
    decodePeerTcpTunnelBinaryFrameV2,
    type PeerTcpTunnelDestinationV1,
    type PeerTcpTunnelSubstreamCapsV2,
} from '@happier-dev/protocol';
import { substreamAbortFrame, isSchedulableTimeoutMs } from './primitives.js';
import { encodePeerTcpTunnelBinaryFrameForSubstream, decodePeerTcpTunnelBinaryFrameForSubstreamSession, peerTcpTunnelBinaryDecodeFailureReason } from './binaryCodec.js';
import { createPeerTcpTunnelStreamSession } from './streamSession.js';
import type { PeerTcpTunnelStreamConnection, PeerTcpTunnelSubstreamMuxSessionResult } from './types.js';

/**
 * One live substream inside the mux. Declared here rather than alongside the other frame
 * primitives because it is used only by the mux and its `session` field ties it to the v1
 * stream session the mux instantiates per substream.
 */
type ActivePeerTcpTunnelSubstream = {
    connection: PeerTcpTunnelStreamConnection;
    session: ReturnType<typeof createPeerTcpTunnelStreamSession>;
    bytes: number;
    lastActivityMs: number;
    idleTimer?: ReturnType<typeof setTimeout>;
};

export function createPeerTcpTunnelSubstreamMuxSession(input: Readonly<{
    tunnelId: string;
    destination: PeerTcpTunnelDestinationV1;
    initialWindowBytes: number;
    maxFrameBytes: number;
    maxBinaryHeaderBytes: number;
    maxRawPayloadBytes: number;
    caps: PeerTcpTunnelSubstreamCapsV2;
    connectTcp: (target: PeerTcpTunnelDestinationV1) => Promise<PeerTcpTunnelStreamConnection>;
    sendBinaryFrame: (frame: Uint8Array) => Promise<void> | void;
    nowMs?: () => number;
}>) {
    const nowMs = input.nowMs ?? Date.now;
    const activeSubstreams = new Map<string, ActivePeerTcpTunnelSubstream>();
    const openedSubstreamIds = new Set<string>();
    let aggregateBytes = 0;
    let lastSessionActivityMs = nowMs();
    let closed = false;
    let sessionIdleTimer: ReturnType<typeof setTimeout> | undefined;

    function clearSessionIdleTimer(): void {
        if (sessionIdleTimer) clearTimeout(sessionIdleTimer);
        sessionIdleTimer = undefined;
    }

    function scheduleSessionIdleTimer(): void {
        if (closed || !isSchedulableTimeoutMs(input.caps.maxSessionIdleMs)) return;
        clearSessionIdleTimer();
        sessionIdleTimer = setTimeout(() => {
            void closeAll('max_idle_exceeded').catch(() => undefined);
        }, input.caps.maxSessionIdleMs);
        sessionIdleTimer.unref?.();
    }

    function scheduleSubstreamIdleTimer(substreamId: string, active: ActivePeerTcpTunnelSubstream): void {
        if (!isSchedulableTimeoutMs(input.caps.maxSubstreamIdleMs)) return;
        if (active.idleTimer) clearTimeout(active.idleTimer);
        active.idleTimer = setTimeout(() => {
            void abortAndCloseSubstream(substreamId, 'max_idle_exceeded').catch(() => undefined);
        }, input.caps.maxSubstreamIdleMs);
        active.idleTimer.unref?.();
    }

    function recordSessionActivity(): void {
        lastSessionActivityMs = nowMs();
        scheduleSessionIdleTimer();
    }

    function clearSubstreamTimer(active: ActivePeerTcpTunnelSubstream): void {
        if (active.idleTimer) clearTimeout(active.idleTimer);
        active.idleTimer = undefined;
    }

    async function sendSubstreamAbort(substreamId: string, reasonCode: string): Promise<void> {
        await input.sendBinaryFrame(substreamAbortFrame({
            tunnelId: input.tunnelId,
            substreamId,
            reasonCode,
        }));
    }

    async function closeSubstream(substreamId: string): Promise<void> {
        const active = activeSubstreams.get(substreamId);
        if (!active) return;
        activeSubstreams.delete(substreamId);
        clearSubstreamTimer(active);
        await active.connection.close();
    }

    async function abortAndCloseSubstream(substreamId: string, reasonCode: string): Promise<void> {
        const localClose = closeSubstream(substreamId);
        let notification: Promise<void>;
        try {
            notification = sendSubstreamAbort(substreamId, reasonCode);
        } catch (error) {
            notification = Promise.reject(error);
        }
        const [notificationResult, closeResult] = await Promise.allSettled([notification, localClose]);
        if (notificationResult.status === 'rejected') throw notificationResult.reason;
        if (closeResult.status === 'rejected') throw closeResult.reason;
    }

    async function closeAll(reasonCode?: string): Promise<void> {
        if (closed) return;
        closed = true;
        clearSessionIdleTimer();
        const substreamIds = [...activeSubstreams.keys()];
        await Promise.all(substreamIds.map(async (substreamId) => {
            if (reasonCode) {
                await abortAndCloseSubstream(substreamId, reasonCode);
                return;
            }
            await closeSubstream(substreamId);
        }));
    }

    function canRecordBytes(substreamId: string, bytes: number): PeerTcpTunnelSubstreamMuxSessionResult {
        const active = activeSubstreams.get(substreamId);
        if (!active) return { ok: false, reasonCode: 'substream_not_open', substreamId };
        if (active.bytes + bytes > input.caps.maxBytesPerSubstream) {
            return { ok: false, reasonCode: 'substream_cap_exceeded', substreamId };
        }
        if (aggregateBytes + bytes > input.caps.maxAggregateBytes) {
            return { ok: false, reasonCode: 'substream_cap_exceeded', substreamId };
        }
        return { ok: true };
    }

    function recordBytes(substreamId: string, bytes: number): void {
        const active = activeSubstreams.get(substreamId);
        if (!active) return;
        active.bytes += bytes;
        aggregateBytes += bytes;
        active.lastActivityMs = nowMs();
        recordSessionActivity();
        scheduleSubstreamIdleTimer(substreamId, active);
    }

    async function openSubstream(substreamId: string): Promise<PeerTcpTunnelSubstreamMuxSessionResult> {
        if (closed) return { ok: false, reasonCode: 'tunnel_closed', substreamId };
        if (activeSubstreams.has(substreamId)) {
            await abortAndCloseSubstream(substreamId, 'substream_id_already_open');
            return { ok: false, reasonCode: 'substream_id_already_open', substreamId };
        }
        if (
            activeSubstreams.size >= input.caps.maxConcurrentSubstreams
            || openedSubstreamIds.size >= input.caps.maxTotalSubstreams
        ) {
            await sendSubstreamAbort(substreamId, 'substream_cap_exceeded');
            return { ok: false, reasonCode: 'substream_cap_exceeded', substreamId };
        }

        let connection: PeerTcpTunnelStreamConnection;
        try {
            connection = await input.connectTcp(input.destination);
        } catch {
            await sendSubstreamAbort(substreamId, 'tcp_connect_failed');
            return { ok: false, reasonCode: 'tcp_connect_failed', substreamId };
        }

        let active: ActivePeerTcpTunnelSubstream;
        const session = createPeerTcpTunnelStreamSession({
            tunnelId: input.tunnelId,
            initialWindowBytes: input.initialWindowBytes,
            maxFrameBytes: input.maxFrameBytes,
            maxDecodedPayloadBytes: input.maxRawPayloadBytes,
            maxSendChunkBytes: input.maxRawPayloadBytes,
            maxIdleMs: input.caps.maxSubstreamIdleMs,
            maxDurationMs: Number.MAX_SAFE_INTEGER,
            maxTotalBytes: input.caps.maxBytesPerSubstream,
            nowMs,
            connection,
            onClosed: () => {
                if (activeSubstreams.get(substreamId) !== active) return;
                activeSubstreams.delete(substreamId);
                clearSubstreamTimer(active);
            },
            sendFrame: async (frame) => {
                if (frame.kind === 'data') {
                    const bytes = frame.payload.byteLength;
                    const accepted = canRecordBytes(substreamId, bytes);
                    if (!accepted.ok) {
                        await abortAndCloseSubstream(substreamId, accepted.reasonCode);
                        return;
                    }
                    recordBytes(substreamId, bytes);
                } else {
                    active.lastActivityMs = nowMs();
                    recordSessionActivity();
                    scheduleSubstreamIdleTimer(substreamId, active);
                }
                await input.sendBinaryFrame(encodePeerTcpTunnelBinaryFrameForSubstream({
                    frame,
                    substreamId,
                }));
                if (frame.kind === 'close' && !frame.halfClose) {
                    await closeSubstream(substreamId);
                }
                if (frame.kind === 'abort') {
                    await closeSubstream(substreamId);
                }
            },
        });

        active = {
            connection,
            session,
            bytes: 0,
            lastActivityMs: nowMs(),
        };
        activeSubstreams.set(substreamId, active);
        openedSubstreamIds.add(substreamId);
        recordSessionActivity();
        scheduleSubstreamIdleTimer(substreamId, active);
        return { ok: true };
    }

    scheduleSessionIdleTimer();

    return {
        async acceptBinaryFrame(raw: Uint8Array): Promise<PeerTcpTunnelSubstreamMuxSessionResult> {
            const decoded = decodePeerTcpTunnelBinaryFrameV2({
                frame: raw,
                maxHeaderBytes: input.maxBinaryHeaderBytes,
                maxPayloadBytes: input.maxRawPayloadBytes,
            });
            if (!decoded.ok) {
                return { ok: false, reasonCode: peerTcpTunnelBinaryDecodeFailureReason(decoded.reasonCode) };
            }
            if (decoded.header.tunnelId !== input.tunnelId) {
                return { ok: false, reasonCode: 'tunnel_id_mismatch' };
            }
            const substreamId = decoded.header.substreamId;
            if (!substreamId) return { ok: false, reasonCode: 'frame_invalid' };

            if (closed) return { ok: false, reasonCode: 'tunnel_closed', substreamId };
            const now = nowMs();
            if (now - lastSessionActivityMs > input.caps.maxSessionIdleMs) {
                await closeAll('max_idle_exceeded');
                return { ok: false, reasonCode: 'max_idle_exceeded', substreamId };
            }

            if (decoded.header.kind === 'open') {
                if (decoded.payload.byteLength !== 0) return { ok: false, reasonCode: 'frame_invalid', substreamId };
                return openSubstream(substreamId);
            }

            const active = activeSubstreams.get(substreamId);
            if (!active) {
                await sendSubstreamAbort(substreamId, 'substream_not_open');
                return { ok: false, reasonCode: 'substream_not_open', substreamId };
            }
            if (now - active.lastActivityMs > input.caps.maxSubstreamIdleMs) {
                await abortAndCloseSubstream(substreamId, 'max_idle_exceeded');
                return { ok: false, reasonCode: 'max_idle_exceeded', substreamId };
            }
            const frame = decodePeerTcpTunnelBinaryFrameForSubstreamSession({
                header: decoded.header,
                payload: decoded.payload,
            });
            if (!frame) {
                await abortAndCloseSubstream(substreamId, 'frame_invalid');
                return { ok: false, reasonCode: 'frame_invalid', substreamId };
            }
            if (frame.kind === 'data') {
                const accepted = canRecordBytes(substreamId, decoded.payload.byteLength);
                if (!accepted.ok) {
                    await abortAndCloseSubstream(substreamId, accepted.reasonCode);
                    return accepted;
                }
            }

            const result = await active.session.acceptFrame(frame);
            if (!result.ok) return { ...result, substreamId };
            if (frame.kind === 'data') {
                recordBytes(substreamId, decoded.payload.byteLength);
            } else {
                active.lastActivityMs = nowMs();
                recordSessionActivity();
                scheduleSubstreamIdleTimer(substreamId, active);
            }
            if (frame.kind === 'close' && !frame.halfClose) {
                await closeSubstream(substreamId);
            }
            if (frame.kind === 'abort') {
                await closeSubstream(substreamId);
            }
            return { ok: true };
        },
        close: () => closeAll(),
    };
}
