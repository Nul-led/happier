import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { McpServerEditorScreen } from '@/components/settings/mcpServers/McpServerEditorScreen';

/** `/settings/mcp/<id>`: a saved MCP server in the collection. A different server is a fresh editor. */
export default React.memo(function McpServerRoute() {
    const { serverId } = useLocalSearchParams<{ serverId?: string | string[] }>();
    const id = Array.isArray(serverId) ? serverId[0] : serverId;
    return <McpServerEditorScreen key={id ?? ''} />;
});
