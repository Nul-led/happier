import * as React from 'react';
import type { McpServersSettingsV1 } from '@happier-dev/protocol';

import { useSettingMutable } from '@/sync/domains/state/storage';
import {
    normalizeMcpServersSettingsV1,
    readWritableMcpServersSettingsV1,
} from '@/sync/domains/settings/mcpServers/normalizeMcpServersSettingsV1';

/**
 * The Account's MCP servers settings as every MCP page reads them: the normalized projection to
 * render, the writable value to derive a write from (null when the stored value is invalid, so no
 * page overwrites it), and the writer.
 */
export function useMcpServersSettings(): Readonly<{
    settings: McpServersSettingsV1;
    writable: McpServersSettingsV1 | null;
    setSettings: (next: McpServersSettingsV1) => void;
}> {
    const [raw, setSettings] = useSettingMutable('mcpServersSettingsV1');
    const settings = React.useMemo(() => normalizeMcpServersSettingsV1(raw), [raw]);
    const writable = React.useMemo(() => readWritableMcpServersSettingsV1(raw), [raw]);
    return { settings, writable, setSettings };
}
