import {
    PluginHostedHtmlSourceV1Schema,
    PluginHostedWebBridgeBootstrapConfigV1Schema,
    UiSurfaceNetworkOriginV1Schema,
    type PluginHostedWebBridgeBootstrapConfigV1,
    type UiSurfaceNetworkOriginV1,
} from '@happier-dev/protocol/plugins/ui';

// The author supplies one self-contained document. Artifact-hosted sources keep
// their separate route-owned policy; inline sources have no resource URL base.
function buildInlineDocumentCsp(connectSrc: string): string {
    return [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        'img-src data:',
        'font-src data:',
        `connect-src ${connectSrc}`,
        "frame-src 'none'",
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join('; ');
}

/**
 * Resolves the `connect-src` directive from the approved egress set.
 *
 * Origins are re-validated through the canonical capability grammar rather
 * than trusted from the caller: this string is concatenated into a security
 * policy, so an origin carrying a `;` or a wildcard would rewrite the whole
 * profile. An unapproved value is a caller defect, not a document to downgrade
 * silently, so it fails closed by throwing instead of resolving to `'none'`.
 */
function resolveConnectSrc(networkOrigins: readonly string[] | undefined): string {
    if (networkOrigins === undefined || networkOrigins.length === 0) return "'none'";
    const approved = [...new Set(networkOrigins.map((origin) => UiSurfaceNetworkOriginV1Schema.parse(origin)))];
    return approved.sort().join(' ');
}

/** Only opaque transport facts enter source; input/context travel over Host API. */
export function buildHostedHtmlDocument(
    html: string,
    bootstrapConfig?: PluginHostedWebBridgeBootstrapConfigV1,
    isolation?: Readonly<{
        networkOrigins?: readonly UiSurfaceNetworkOriginV1[];
        externalHttpLinks?: boolean;
    }>,
): string {
    const source = PluginHostedHtmlSourceV1Schema.parse({ kind: 'html', html });
    const inlineDocumentCsp = buildInlineDocumentCsp(resolveConnectSrc(isolation?.networkOrigins));
    const bootstrap = bootstrapConfig === undefined ? '' : (() => {
        const config = PluginHostedWebBridgeBootstrapConfigV1Schema.parse(bootstrapConfig);
        const encoded = JSON.stringify(config).replaceAll('<', '\\u003c');
        return `<script>Object.defineProperty(globalThis,"__HAPPIER_UI_FRAME_BOOTSTRAP_V1__",{value:Object.freeze(${encoded}),writable:false,configurable:false});</script>`;
    })();
    const externalLinks = isolation && 'externalHttpLinks' in isolation
        && isolation.externalHttpLinks === true
        ? '<script>Object.defineProperty(globalThis,"__HAPPIER_UI_FRAME_EXTERNAL_LINKS_V1__",{value:true,writable:false,configurable:false});</script>'
        : '';
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${inlineDocumentCsp}">${externalLinks}${bootstrap}${source.html}`;
}
