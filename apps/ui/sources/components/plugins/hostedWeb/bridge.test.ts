import { describe, expect, it } from 'vitest';

import { validatePluginHostedWebBridgeMessage } from './bridge';

const message = { identity: { instanceId: 'mount-1', mountNonce: 'nonce-1' }, version: 1, sequence: 1, kind: 'ready', payload: { ready: true } } as const;

function nestedPayload(depth: number): unknown {
    let value: unknown = null;
    for (let index = 0; index < depth; index += 1) {
        value = [value];
    }
    return value;
}

describe('plugin hosted web bridge validation', () => {
    it('accepts messages only when origin, nonce, and descriptor binding match', () => {
        expect(validatePluginHostedWebBridgeMessage({
            message,
            origin: 'https://preview.example.test',
            expectedOrigin: 'https://preview.example.test',
            identity: message.identity,
            allowedMessageKinds: new Set(['ready']),
        })).toEqual({ ok: true, envelope: message });
    });

    it('fails closed for wrong origin, nonce, or bridge message kind', () => {
        expect(validatePluginHostedWebBridgeMessage({
            message: { ...message, identity: { ...message.identity, mountNonce: 'wrong' } },
            origin: 'https://preview.example.test',
            expectedOrigin: 'https://preview.example.test',
            identity: message.identity,
            allowedMessageKinds: new Set(['ready']),
        })).toEqual({ ok: false, code: 'identity_mismatch' });

        expect(validatePluginHostedWebBridgeMessage({
            message,
            origin: 'https://evil.example.test',
            expectedOrigin: 'https://preview.example.test',
            identity: message.identity,
            allowedMessageKinds: new Set(['ready']),
        })).toEqual({ ok: false, code: 'origin_mismatch' });

        expect(validatePluginHostedWebBridgeMessage({
            message,
            origin: 'https://preview.example.test',
            expectedOrigin: 'https://preview.example.test',
            identity: message.identity,
            allowedMessageKinds: new Set(['requestHostAction']),
        })).toEqual({ ok: false, code: 'message_kind_denied' });
    });

    it('rejects another physical instance before readiness and on later requests', () => {
        const otherIdentity = { ...message.identity, instanceId: 'mount-2' };
        expect(validatePluginHostedWebBridgeMessage({
            message: { ...message, identity: otherIdentity },
            origin: 'https://preview.example.test',
            expectedOrigin: 'https://preview.example.test',
            identity: message.identity,
            allowedMessageKinds: new Set(['ready']),
        })).toEqual({ ok: false, code: 'identity_mismatch' });

        expect(validatePluginHostedWebBridgeMessage({
            message: {
                ...message,
                identity: otherIdentity,
                kind: 'hostApi',
                payload: { kind: 'negotiate' },
            },
            origin: 'https://preview.example.test',
            expectedOrigin: 'https://preview.example.test',
            identity: message.identity,
            allowedMessageKinds: new Set(['ready', 'hostApi']),
        })).toEqual({ ok: false, code: 'identity_mismatch' });
    });

    it('accepts deeply nested strict JSON before enforcing nonce identity', () => {
        let result: ReturnType<typeof validatePluginHostedWebBridgeMessage> | undefined;
        expect(() => {
            result = validatePluginHostedWebBridgeMessage({
                message: { ...message, identity: { ...message.identity, mountNonce: 'wrong' }, payload: nestedPayload(12_000) },
                origin: 'https://preview.example.test',
                expectedOrigin: 'https://preview.example.test',
                identity: message.identity,
                allowedMessageKinds: new Set(['ready']),
            });
        }).not.toThrow();

        expect(result).toEqual({ ok: false, code: 'identity_mismatch' });
    });
});
