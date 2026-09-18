import * as React from 'react';

import { PluginHostedWebFrame } from '@/components/plugins/hostedWeb/PluginHostedWebFrame';

/**
 * Shared physical hosted-frame leaf. Installed Artifact policy and caller HTML
 * approval remain in outer adapters; this host owns only the selected frame
 * implementation and its mount props.
 */
export function HostedFrameHost(
    props: React.ComponentProps<typeof PluginHostedWebFrame>,
): React.ReactElement {
    return <PluginHostedWebFrame {...props} />;
}
