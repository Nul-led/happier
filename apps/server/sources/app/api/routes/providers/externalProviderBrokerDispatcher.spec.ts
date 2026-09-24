import {
    decodePeerTcpTunnelBinaryFrameV2,
    encodePeerTcpTunnelBinaryFrameV2,
    type PeerTcpTunnelRelayEnvelope,
} from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
    createExternalProviderBrokerDispatcher,
    mapProviderBrokerApplicationFailure,
} from './externalProviderBrokerDispatcher';

describe('external Provider broker dispatcher', () => {
    it('maps only trusted broker denial codes to the closed public error vocabulary', () => {
        expect(mapProviderBrokerApplicationFailure(403, {
            'x-happier-provider-broker-error-code': 'team_credential_usage_limit',
            'x-happier-provider-broker-limit-metric': 'total_tokens',
            'x-happier-provider-broker-limit-remaining': '0',
            'x-happier-provider-broker-limit-resets-at': '2026-09-15T00:00:00.000Z',
        })).toEqual({ error: 'team_credential_usage_limit', retryAtMs: Date.parse('2026-09-15T00:00:00.000Z') });
        expect(mapProviderBrokerApplicationFailure(403, {
            'x-happier-provider-broker-error-code': 'cost_limit_unavailable',
        })).toEqual({ error: 'cost_limit_unavailable' });
        expect(mapProviderBrokerApplicationFailure(403, {
            'x-happier-provider-broker-error-code': 'resource_changed',
        })).toEqual({ error: 'resource_unavailable' });
        expect(mapProviderBrokerApplicationFailure(499, {
            'x-happier-provider-broker-error-code': 'request_cancelled',
        })).toEqual({ error: 'request_cancelled' });
        expect(mapProviderBrokerApplicationFailure(403, {
            'x-happier-provider-broker-error-code': 'secret-provider-detail',
        })).toEqual({ error: 'policy_denied' });
    });

    async function dispatchWithUpstreamResponse(response: Uint8Array) {
        let receive: ((envelope: PeerTcpTunnelRelayEnvelope) => void) | undefined;
        let responseSent = false;
        const relaySocketId = 'relay-socket-1';
        const machineId = 'broker-machine-1';
        const accountId = 'custodian-account-1';
        let transportCloseCount = 0;
        const dispatch = createExternalProviderBrokerDispatcher({
            enabled: true,
            env: {
                HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: 'test-key',
                HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: Buffer.alloc(32, 7).toString('base64url'),
            },
            createRelayTransport: () => ({
                relaySocketId,
                subscribe(handler) { receive = handler; return () => {}; },
                close() { transportCloseCount += 1; },
                send(_event, envelope) {
                    if (envelope.v !== 2 || responseSent) return;
                    const decoded = decodePeerTcpTunnelBinaryFrameV2({
                        frame: envelope.frame,
                        maxHeaderBytes: 64 * 1024,
                        maxPayloadBytes: 64 * 1024,
                    });
                    if (!decoded.ok || decoded.header.kind !== 'data') return;
                    responseSent = true;
                    receive?.({
                        v: 2,
                        scopeUserId: accountId,
                        sender: { kind: 'machine', machineId },
                        recipient: { kind: 'user', socketId: relaySocketId },
                        encoding: 'binary_frame_v2',
                        frame: encodePeerTcpTunnelBinaryFrameV2({
                            header: {
                                version: 2,
                                kind: 'data',
                                tunnelId: decoded.header.tunnelId,
                                substreamId: decoded.header.substreamId,
                                direction: 'daemon_to_client',
                                sequence: 0,
                                payloadLength: response.byteLength,
                            },
                            payload: response,
                        }),
                    });
                    receive?.({
                        v: 1,
                        scopeUserId: accountId,
                        sender: { kind: 'machine', machineId },
                        recipient: { kind: 'user', socketId: relaySocketId },
                        frame: {
                            v: 1,
                            kind: 'close',
                            tunnelId: decoded.header.tunnelId,
                            halfClose: false,
                            reasonCode: 'completed',
                        },
                    });
                },
            }),
        });

        const cancellation = new AbortController();
        const removeAbortListener = vi.spyOn(cancellation.signal, 'removeEventListener');
        const result = await dispatch({
            target: { custodianAccountId: accountId, brokerMachineId: machineId },
            signal: cancellation.signal,
            request: {
                v: 1,
                requestId: 'request-1',
                teamId: 'team-1',
                resourceId: 'resource-1',
                caller: {
                    kind: 'external_api_key',
                    keyId: '550e8400-e29b-41d4-a716-446655440000',
                    assignedAccountId: 'account-1',
                    assignedTeamMembershipId: 'membership-1',
                },
                route: 'models',
                method: 'GET',
                pathAndQuery: '/v1/models',
                bodyBase64: null,
            },
        });

        return { result, removeAbortListener, transportCloseCount: () => transportCloseCount };
    }

    function httpResponse(body: string) {
        return new TextEncoder().encode(
            `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
        );
    }

    // The relay coalesces whatever it has: a small control response and a legal
    // 32 KiB body can both arrive in the dispatcher's first chunk. The header
    // budget bounds headers, so neither may be refused as an oversized header.
    it.each([128, 32 * 1024])('accepts the admitted broker machine binary response coalesced with a %i-byte body', async (size) => {
        const body = 'o'.repeat(size);
        const { result, removeAbortListener, transportCloseCount } = await dispatchWithUpstreamResponse(httpResponse(body));
        expect(result).toMatchObject({ ok: true, statusCode: 200 });
        if (!result.ok) return;
        const chunks: Uint8Array[] = [];
        for await (const chunk of result.body) chunks.push(chunk);
        expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')).toBe(body);
        expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(transportCloseCount()).toBe(1);
    });

    it('still refuses a header segment larger than the header budget', async () => {
        const { result } = await dispatchWithUpstreamResponse(
            new TextEncoder().encode(`HTTP/1.1 200 OK\r\nX-Oversized: ${'h'.repeat(24 * 1024)}`),
        );
        expect(result).toEqual({ ok: false, error: 'upstream_unavailable' });
    });
});
