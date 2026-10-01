import { expect, it } from 'vitest';
import type { LocalServicePreviewResourceV1 } from '@happier-dev/protocol/local/services/preview/v1';
import { proxyLocalServicePreviewWebSocketUpgrade } from './websocketAdapter.js';

it('denies a WebSocket upgrade when the registered method policy excludes GET', async () => {
    const preview: LocalServicePreviewResourceV1 = {
        previewId: 'preview_1', machineId: 'machine_1', owner: { kind: 'user', id: 'account_1' },
        target: { scheme: 'http', host: '127.0.0.1', port: 5173 }, initialPath: { pathname: '/', search: '' },
        display: { title: 'Preview', addressLabel: 'loopback' }, originMode: 'host',
        policy: { allowedMethods: ['POST'], cookiePolicy: 'drop', compressionPolicy: 'identity',
            redirectPolicy: 'preserve_host_origin', maxRequestBodyBytes: 1024, maxResponseBodyBytes: 1024 },
    };
    const output: Uint8Array[] = [];
    const result = await proxyLocalServicePreviewWebSocketUpgrade({
        preview,
        request: { path: '/hmr', search: '', headers: { upgrade: 'websocket', connection: 'Upgrade',
            'sec-websocket-key': 'client-key', 'sec-websocket-version': '13' }, rawHeaders: [],
            client: { async *read() {}, write: (bytes) => { output.push(bytes); }, end() {}, destroy() {} } },
        // The upstream network is a genuine boundary; policy must refuse before dialing it.
        openTunnel: async () => { throw new Error('No registered GET authority'); },
    });
    expect(result).toEqual({ ok: false, reasonCode: 'method_not_allowed' });
    expect(output.map((bytes) => new TextDecoder().decode(bytes)).join('')).toContain('HTTP/1.1 405 Method Not Allowed');
});
