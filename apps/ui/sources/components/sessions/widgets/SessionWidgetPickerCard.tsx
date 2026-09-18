import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { PluginContributionIdentityV1 } from '@happier-dev/protocol';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { SurfaceCard } from '@/components/ui/cards/SurfaceCard';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import {
    type SessionWidgetCandidate,
} from './sessionWidgetCatalog';

/**
 * The **From plugins…** Add picker.
 *
 * It renders the exact policy-admitted selection already owned by the mounted
 * Board composition and hands one stable `{pluginId, localId}` back to the Board
 * controller, which performs the ordinary atomic item creation. Keeping the
 * selection outside this component makes the Add entry and picker incapable of
 * evaluating different Home/Session policy facts.
 *
 * Selecting a row never mounts a hidden executable frame behind the picker:
 * candidates are described by their declaration, so browsing costs no plugin
 * execution, no Host API binding and no Resource subscription.
 */

const stylesheet = StyleSheet.create((theme) => ({
    header: {
        gap: 4,
        paddingBottom: 12,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        color: theme.colors.text.primary,
    },
    description: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text.secondary,
    },
    actions: {
        flexDirection: 'row',
        gap: 8,
        paddingTop: 12,
    },
}));

export type SessionWidgetPickerCardProps = Readonly<{
    /** The exact policy-admitted list also used to expose the Add-menu entry. */
    candidates: readonly SessionWidgetCandidate[];
    onAdd: (candidate: Readonly<{ surface: PluginContributionIdentityV1; title: string }>) => void;
    onCancel: () => void;
    testID?: string;
}>;

function candidateAccessibilityLabel(candidate: SessionWidgetCandidate): string {
    // Two installed plugins may present the same display name. The row then
    // announces the qualified plugin id so they never sound identical.
    const plugin = candidate.sharedPluginName
        ? t('sessionBoard.picker.qualified', {
            plugin: candidate.pluginName,
            pluginId: candidate.surface.pluginId,
        })
        : candidate.pluginName;
    return `${candidate.title}, ${plugin}`;
}

function PickerList(props: Readonly<{
    candidates: readonly SessionWidgetCandidate[];
    onAdd: SessionWidgetPickerCardProps['onAdd'];
    testID: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();

    if (props.candidates.length === 0) {
        return (
            <SurfaceStateCard
                testID={`${props.testID}-empty`}
                kind="empty"
                title={t('sessionBoard.picker.empty.title')}
                reason={t('sessionBoard.picker.empty.reason')}
                accessibilitySemantics="status"
            />
        );
    }

    return (
        <ItemGroup>
            {props.candidates.map((candidate, index) => (
                <Item
                    key={`${candidate.surface.pluginId}:${candidate.surface.localId}`}
                    testID={`${props.testID}-candidate-${candidate.surface.pluginId}-${candidate.surface.localId}`}
                    title={candidate.title}
                    subtitle={candidate.sharedPluginName
                        ? t('sessionBoard.picker.qualified', {
                            plugin: candidate.pluginName,
                            pluginId: candidate.surface.pluginId,
                        })
                        : candidate.pluginName}
                    icon={<Icon name={candidate.icon} size={29} color={theme.colors.text.secondary} />}
                    accessibilityLabel={candidateAccessibilityLabel(candidate)}
                    showDivider={index < props.candidates.length - 1}
                    onPress={() => props.onAdd({ surface: candidate.surface, title: candidate.title })}
                />
            ))}
        </ItemGroup>
    );
}

export function SessionWidgetPickerCard(
    props: SessionWidgetPickerCardProps,
): React.ReactElement {
    const styles = stylesheet;
    const testID = props.testID ?? 'session-widget-picker';
    return (
        <SurfaceCard testID={testID} padding="md">
            <View style={styles.header}>
                {/*
                  * Announced when it appears, without taking focus away from the
                  * control the person just used to open it.
                  */}
                <Text
                    style={styles.title}
                    accessibilityRole="header"
                    accessibilityLiveRegion="polite"
                >
                    {t('sessionBoard.picker.title')}
                </Text>
                <Text style={styles.description}>{t('sessionBoard.picker.description')}</Text>
            </View>
            <PickerList
                candidates={props.candidates}
                onAdd={props.onAdd}
                testID={testID}
            />
            <View style={styles.actions}>
                <RoundButton
                    size="small"
                    display="inverted"
                    testID={`${testID}-cancel`}
                    title={t('common.cancel')}
                    onPress={props.onCancel}
                />
            </View>
        </SurfaceCard>
    );
}
