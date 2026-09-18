// The narrow UI subpath, not the protocol root: the root index reaches
// marketplace/machine modules that pull Node builtins into a browser bundle,
// and this leaf needs exactly one hosted-web schema.
import {
    PluginHostedWebBridgeEnvelopeV1Schema,
    pluginUiHostApiWireIdentitiesEqual,
    type PluginHostedWebBridgeEnvelopeV1,
    type PluginUiHostApiWireIdentityV1,
} from '@happier-dev/protocol/plugins/ui';

export type PluginHostedWebBridgeValidationCode =
    | 'invalid_message'
    | 'origin_mismatch'
    | 'identity_mismatch'
    | 'message_kind_denied';

export type PluginHostedWebBridgeValidationResult =
    | Readonly<{ ok: true; envelope: PluginHostedWebBridgeEnvelopeV1 }>
    | Readonly<{ ok: false; code: PluginHostedWebBridgeValidationCode }>;

export function validatePluginHostedWebBridgeMessage(params: Readonly<{
    message: unknown;
    origin: string;
    expectedOrigin: string;
    identity: PluginUiHostApiWireIdentityV1;
    allowedMessageKinds: ReadonlySet<string>;
}>): PluginHostedWebBridgeValidationResult {
    if (params.origin !== params.expectedOrigin) {
        return Object.freeze({ ok: false, code: 'origin_mismatch' });
    }

    const parsed = PluginHostedWebBridgeEnvelopeV1Schema.safeParse(params.message);
    if (!parsed.success) {
        return Object.freeze({ ok: false, code: 'invalid_message' });
    }
    const envelope = parsed.data;

    if (!pluginUiHostApiWireIdentitiesEqual(params.identity, envelope.identity)) {
        return Object.freeze({ ok: false, code: 'identity_mismatch' });
    }
    if (!params.allowedMessageKinds.has(envelope.kind)) {
        return Object.freeze({ ok: false, code: 'message_kind_denied' });
    }

    return Object.freeze({ ok: true, envelope });
}
