import * as React from 'react';
import { Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { useMachineAgents } from '@/agents/machineAgents/useMachineAgents';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { machineCollectionHref } from '@/components/settings/machines/collection/machineCollectionModel';
import { Text } from '@/components/ui/text/Text';
import { MachineCliLogoRow } from './MachineCliLogoRow';
import { motionTokens } from '@/components/ui/motion/motionTokens';
import { t } from '@/text';


type Props = {
    machineId: string;
    isOnline: boolean;
    serverId?: string | null;
    /**
     * When true, the component may refresh the machine-agent inventory.
     * When false, it will render cached results only (no automatic fetching).
     */
    autoDetect?: boolean;
};

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 6,
    },
    placeholder: {
        color: theme.colors.text.secondary,
        opacity: 0.35,
        ...Typography.default(),
    },
}));

export const MachineCliGlyphs = React.memo(({ machineId, isOnline, serverId, autoDetect = true }: Props) => {
    const styles = stylesheet;
    const router = useRouter();
    const activeServer = useActiveServerSnapshot(!serverId);
    const resolvedServerId = serverId ?? activeServer.serverId;
    const inventory = useMachineAgents({
        machineId,
        serverId: resolvedServerId,
        load: autoDetect && isOnline,
    });

    const onPress = React.useCallback(() => {
        router.push(machineCollectionHref({ machineId, serverId: resolvedServerId }) as never);
    }, [machineId, resolvedServerId, router]);

    const availableAgentIds = React.useMemo(() => inventory.agents
        .filter((agent) => agent.installed)
        .map((agent) => agent.agentId), [inventory.agents]);

    return (
        <Pressable
            testID="machine-agent-glyphs"
            accessibilityRole="button"
            accessibilityLabel={t('machineAgents.sectionTitle')}
            onPress={onPress}
            style={({ pressed }) => [
                styles.container,
                { opacity: !isOnline ? 0.5 : (pressed ? motionTokens.press.opacity : 1) },
            ]}
        >
            {availableAgentIds.length === 0 ? (
                <Text style={styles.placeholder}>•</Text>
            ) : (
                <MachineCliLogoRow agentIds={availableAgentIds} />
            )}
        </Pressable>
    );
});
