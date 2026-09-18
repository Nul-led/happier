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

    it('accepts the admitted broker machine binary response for the exact relay substream', async () => {
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
                    const response = new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok');
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

        expect(result).toMatchObject({ ok: true, statusCode: 200 });
        if (!result.ok) return;
        const chunks: Uint8Array[] = [];
        for await (const chunk of result.body) chunks.push(chunk);
        expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')).toBe('ok');
        expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(transportCloseCount).toBe(1);
    });
});
