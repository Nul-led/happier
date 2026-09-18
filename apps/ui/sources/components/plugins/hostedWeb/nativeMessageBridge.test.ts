import { describe, expect, it, vi } from 'vitest';

import {
    createPluginHostedWebNativeMessageBridge,
    PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT,
} from './nativeMessageBridge';

const frameOrigin = 'happier-hosted-artifact://hpa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('hosted-web native bridge message adapter', () => {
    it('admits an exact about:blank sender only for an opaque inline mount', () => {
        const identity = { instanceId: 'inline-1', mountNonce: 'nonce-1' };
        const onMessage = vi.fn();
        const config = { identity, allowedMessageKinds: new Set(['ready']), onMessage };
        const inline = createPluginHostedWebNativeMessageBridge({ bridge: { ...config, expectedOrigin: 'null' } });
        const artifact = createPluginHostedWebNativeMessageBridge({ bridge: { ...config, expectedOrigin: frameOrigin } });
        const message = JSON.stringify({ version: 1, identity, sequence: 1, kind: 'ready', payload: {} });
        inline({ nativeEvent: { data: message } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        inline({ nativeEvent: { data: message, url: 'about:blank?replacement' } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        artifact({ nativeEvent: { data: message, url: 'about:blank' } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        expect(onMessage).not.toHaveBeenCalled();
        inline({ nativeEvent: { data: message, url: 'about:blank' } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        expect(onMessage).toHaveBeenCalledTimes(1);
        inline({ nativeEvent: { data: message, url: 'about:blank#section' } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        expect(onMessage).toHaveBeenCalledTimes(2);
        inline({ nativeEvent: { data: JSON.stringify({ version: 1, identity: { ...identity, mountNonce: 'old' }, sequence: 2, kind: 'ready', payload: {} }), url: 'about:blank' } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        expect(onMessage).toHaveBeenCalledTimes(2);
    });
    it('accepts a message only from the exact token-scoped iOS frame origin', () => {
        const onMessage = vi.fn();
        const bridgeInput = {
            bridge: {
                expectedOrigin: frameOrigin,
                identity: { instanceId: 'mount-1', mountNonce: 'nonce-1' },
                allowedMessageKinds: new Set(['ready']),
                onMessage,
            },
        };
        const onNativeMessage = createPluginHostedWebNativeMessageBridge(bridgeInput);
        const message = JSON.stringify({ identity: { instanceId: 'mount-1', mountNonce: 'nonce-1' }, version: 1, sequence: 1, kind: 'ready', payload: null });

        onNativeMessage({ nativeEvent: { data: message } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        onNativeMessage({ nativeEvent: { url: `${frameOrigin}/index.html`, data: message } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        onNativeMessage({ nativeEvent: { url: 'happier-artifact://hpa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html', data: message } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(onMessage).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'ready' }),
            PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT,
        );
    });

    it('maps only the registrar-bound native inline origin to the logical null document origin', () => {
        const identity = { instanceId: 'inline-1', mountNonce: 'nonce-1' };
        const onMessage = vi.fn();
        const physicalFrameOrigin = `happier-hosted-artifact://hpa_${'b'.repeat(64)}`;
        const onNativeMessage = createPluginHostedWebNativeMessageBridge({
            bridge: {
                expectedOrigin: 'null',
                identity,
                allowedMessageKinds: new Set(['ready']),
                onMessage,
            },
            physicalFrameOrigin,
        });
        const message = JSON.stringify({ version: 1, identity, sequence: 1, kind: 'ready', payload: null });

        onNativeMessage({ nativeEvent: { url: 'about:blank', data: message } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        onNativeMessage({ nativeEvent: { url: `${physicalFrameOrigin}/`, data: message } }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);
        onNativeMessage({
            nativeEvent: {
                url: `happier-hosted-artifact://hpa_${'c'.repeat(64)}/`,
                data: message,
            },
        }, PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT);

        expect(onMessage).toHaveBeenCalledTimes(1);
    });
});
