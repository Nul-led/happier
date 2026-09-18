import type {
    PluginHostedWebBridgeEnvelopeV1,
    PluginHostedWebBridgeResponseEnvelopeV1,
    PluginUiHostApiWireIdentityV1,
} from '@happier-dev/protocol/plugins/ui';
import { readPluginHostedWebBridgeFrameOriginV1 } from '@happier-dev/protocol/plugins/ui';
import { isBrowserInlineDocumentUrl } from '@/sync/domains/browser/adapters/nativeNavigation';
import type { BrowserFrameMessageReceipt } from '@/components/browser/frame/types';

import { validatePluginHostedWebBridgeMessage } from './bridge';

/**
 * Direct native/Wry frame adapters have no browser focus-token owner. They
 * still pass the canonical receipt shape so downstream host-action admission
 * can fail closed without a transport-specific `undefined` compatibility path.
 */
export const PLUGIN_HOSTED_WEB_NO_TRANSIENT_ACTIVATION_RECEIPT: BrowserFrameMessageReceipt = Object.freeze({
    consumeTransientActivation: () => false,
});

export type PluginHostedWebNativeBridgeConfig = Readonly<{
    expectedOrigin: string;
    identity: PluginUiHostApiWireIdentityV1;
    allowedMessageKinds: ReadonlySet<string>;
    onMessage: (
        envelope: PluginHostedWebBridgeEnvelopeV1,
        receipt: BrowserFrameMessageReceipt,
    ) => void | PluginHostedWebBridgeResponseEnvelopeV1 | Promise<PluginHostedWebBridgeResponseEnvelopeV1 | void>;
}>;

type NativeMessageEvent = Readonly<{
    nativeEvent?: Readonly<{
        data?: unknown;
        url?: unknown;
    }>;
}>;

function readFrameOrigin(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        return readPluginHostedWebBridgeFrameOriginV1(new URL(value));
    } catch {
        return null;
    }
}

/**
 * The one native inbound-bridge adapter shared by generic and Artifact-backed
 * frames. Protocol owns the exceptional iOS scheme grammar; this adapter only
 * parses the native event and delegates address and envelope authority there.
 */
export function createPluginHostedWebNativeMessageBridge(input: Readonly<{
    bridge: PluginHostedWebNativeBridgeConfig;
    /**
     * Exact token-derived origin for a natively registered inline document.
     * The public bridge keeps the same logical `null` origin as browser inline
     * HTML; only this physical adapter may map its verified local origin.
     */
    physicalFrameOrigin?: string;
}>): (event: NativeMessageEvent, receipt: BrowserFrameMessageReceipt) => void | PluginHostedWebBridgeResponseEnvelopeV1 | Promise<PluginHostedWebBridgeResponseEnvelopeV1 | void> {
    return (event, receipt) => {
        const rawData = event.nativeEvent?.data;
        if (typeof rawData !== 'string') return;
        let message: unknown;
        try {
            message = JSON.parse(rawData);
        } catch {
            return;
        }
        // Native transport sender evidence is mandatory. Desktop's exact
        // view-id owner injects its verified fact before this shared adapter.
        const physicalMessageOrigin = readFrameOrigin(event.nativeEvent?.url);
        const messageOrigin = input.bridge.expectedOrigin === 'null'
            && typeof event.nativeEvent?.url === 'string'
            && (input.physicalFrameOrigin !== undefined
                ? physicalMessageOrigin === input.physicalFrameOrigin
                : isBrowserInlineDocumentUrl(event.nativeEvent.url))
            ? 'null'
            : physicalMessageOrigin;
        if (!messageOrigin) return;
        const result = validatePluginHostedWebBridgeMessage({
            message,
            origin: messageOrigin,
            expectedOrigin: input.bridge.expectedOrigin,
            identity: input.bridge.identity,
            allowedMessageKinds: input.bridge.allowedMessageKinds,
        });
        return result.ok ? input.bridge.onMessage(result.envelope, receipt) : undefined;
    };
}
