import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { hasAgentIconMark } from '@/agents/catalog/catalog';
import { AgentIcon } from '@/agents/registry/AgentIcon';
import { Icon } from '@/components/ui/icons/Icon';

const stylesheet = StyleSheet.create((theme) => ({
    // A real mark sits on a borderless fill (components.md: identity marks); the fallback glyph too,
    // so the header keeps its geometry whichever the catalog supplies.
    tile: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface.inset,
    },
}));

/**
 * The Agent behind a Run, drawn with the mark its catalog entry contributes. Generic UI never
 * branches on Agent ids: the catalog decides whether a mark exists; without one the tile keeps a
 * neutral glyph rather than a blank space.
 */
export const ExecutionRunAgentMark = React.memo((props: Readonly<{
    agentId: string | null;
    /** The tile's side; the mark is drawn at a little over half of it. */
    size: number;
    testID?: string;
}>) => {
    const { theme } = useUnistyles();
    const markSize = Math.round(props.size * 0.56);
    const hasMark = props.agentId !== null && hasAgentIconMark(props.agentId, theme);
    return (
        <View
            testID={props.testID}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[stylesheet.tile, { width: props.size, height: props.size, borderRadius: Math.round(props.size * 0.3) }]}
        >
            {hasMark && props.agentId
                ? <AgentIcon agentId={props.agentId} size={markSize} />
                : <Icon name="sparkle" size={markSize} color={theme.colors.text.secondary} />}
        </View>
    );
});
