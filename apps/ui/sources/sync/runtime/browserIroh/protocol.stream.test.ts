import { describe, expect, it } from 'vitest';

import { parseBrowserIrohClientCommand, parseBrowserIrohWorkerReply } from './protocol';

describe('sync/runtime/browserIroh/protocol stream commands', () => {
    it('accepts the bounded incremental stream command family', () => {
        const bytes = new Uint8Array([1, 2, 3]);

        expect(parseBrowserIrohClientCommand({
            v: 1,
            kind: 'openStream',
            requestId: 'open-1',
            leaseId: 'lease-1',
            streamKind: 'home',
            endpointId: 'endpoint-1',
            relayUrls: ['https://relay.happier.test'],
        })).toMatchObject({
            kind: 'openStream',
            leaseId: 'lease-1',
            streamKind: 'home',
            endpointId: 'endpoint-1',
        });
        expect(parseBrowserIrohClientCommand({
            v: 1,
            kind: 'readStream',
            requestId: 'read-1',
            streamId: 'stream-1',
            maxBytes: 1024,
        })).toEqual({ v: 1, kind: 'readStream', requestId: 'read-1', streamId: 'stream-1', maxBytes: 1024 });
        expect(parseBrowserIrohClientCommand({
            v: 1,
            kind: 'writeStream',
            requestId: 'write-1',
            streamId: 'stream-1',
            bytes,
        })).toEqual({ v: 1, kind: 'writeStream', requestId: 'write-1', streamId: 'stream-1', bytes });

        for (const kind of ['finishStreamWrite', 'cancelStream', 'closeStream'] as const) {
            expect(parseBrowserIrohClientCommand({
                v: 1,
                kind,
                requestId: `${kind}-1`,
                streamId: 'stream-1',
            })).toMatchObject({ kind, streamId: 'stream-1' });
        }
    });

    it('rejects out-of-bound chunks, invalid byte carriers, and unknown fields', () => {
        expect(parseBrowserIrohClientCommand({
            v: 1,
            kind: 'readStream',
            requestId: 'read-1',
            streamId: 'stream-1',
            maxBytes: 0,
        })).toBeNull();
        expect(parseBrowserIrohClientCommand({
            v: 1,
            kind: 'writeStream',
            requestId: 'write-1',
            streamId: 'stream-1',
            bytes: [1, 2, 3],
        })).toBeNull();
        expect(parseBrowserIrohClientCommand({
            v: 1,
            kind: 'closeStream',
            requestId: 'close-1',
            streamId: 'stream-1',
            clientId: 'forged-client',
        })).toBeNull();
    });

    it('carries the machine stream kind as a closed value, never an ALPN string', () => {
        expect(parseBrowserIrohClientCommand({
            v: 1,
            kind: 'openStream',
            requestId: 'open-machine',
            leaseId: 'lease-1',
            streamKind: 'machine',
            endpointId: 'endpoint-1',
            relayUrls: ['https://relay.happier.test'],
        })).toMatchObject({ kind: 'openStream', streamKind: 'machine' });

        // A caller-supplied ALPN — even the real one — cannot cross this
        // boundary: the protocol is named by a closed kind, not a string the
        // worker would have to interpret.
        for (const streamKind of [
            'happier/machine/1',
            'happier/home-tunnel/1',
            'Machine',
            '',
            1,
            null,
        ]) {
            expect(parseBrowserIrohClientCommand({
                v: 1,
                kind: 'openStream',
                requestId: 'open-bad',
                leaseId: 'lease-1',
                streamKind,
                endpointId: 'endpoint-1',
                relayUrls: ['https://relay.happier.test'],
            })).toBeNull();
        }

        // An open that does not name its protocol at all is refused rather
        // than defaulted: a machine dial must never be served as a Home dial.
        expect(parseBrowserIrohClientCommand({
            v: 1,
            kind: 'openStream',
            requestId: 'open-bad',
            leaseId: 'lease-1',
            endpointId: 'endpoint-1',
            relayUrls: ['https://relay.happier.test'],
        })).toBeNull();
    });

    it('reports only a relay-only observed path on an opened stream', () => {
        for (const observedPath of ['relay', 'unknown'] as const) {
            expect(parseBrowserIrohWorkerReply({
                v: 1,
                kind: 'streamOpened',
                requestId: 'open-1',
                streamId: 'stream-1',
                remoteEndpointId: 'endpoint-remote',
                observedPath,
            })).toMatchObject({ kind: 'streamOpened', observedPath });
        }
        // A browser has no IP transports, so `direct` is not a value this
        // boundary can carry at all.
        expect(parseBrowserIrohWorkerReply({
            v: 1,
            kind: 'streamOpened',
            requestId: 'open-1',
            streamId: 'stream-1',
            remoteEndpointId: 'endpoint-remote',
            observedPath: 'direct',
        })).toBeNull();
    });

    it('parses binary read replies without widening the carrier', () => {
        const bytes = new Uint8Array([4, 5]);
        expect(parseBrowserIrohWorkerReply({
            v: 1,
            kind: 'streamRead',
            requestId: 'read-1',
            bytes,
            done: false,
        })).toEqual({ v: 1, kind: 'streamRead', requestId: 'read-1', bytes, done: false });
    });

    it('rejects unknown reply fields at the structured-clone boundary', () => {
        expect(parseBrowserIrohWorkerReply({
            v: 1,
            kind: 'streamClosed',
            requestId: 'close-1',
            leaked: true,
        })).toBeNull();
    });
});
