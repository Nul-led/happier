import * as React from 'react';
import { Platform, Pressable, View, type GestureResponderEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { StatusDot } from '@/components/ui/status/StatusDot';
import { MachineCliGlyphs } from '@/components/sessions/new/components/MachineCliGlyphs';
import { t } from '@/text';
import type { Machine } from '@/sync/domains/state/storageTypes';
import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import { isMachineOnline } from '@/utils/sessions/machineUtils';

import { resolveMachinePickerPresence } from '../resolveMachinePickerPresence';
import { Icon } from '@/components/ui/icons/Icon';

type AccessoryPressEvent = Partial<GestureResponderEvent> & {
    nativeEvent?: GestureResponderEvent['nativeEvent'] & {
        stopImmediatePropagation?: () => void;
    };
};

/**
 * The presence dot leading a machine row's status line ("● Online · …"). It carries the row's
 * readiness state (`data-state`: ready / offline / revoked / replaced) for tests and automation.
 */
export function MachinePresenceDot(props: Readonly<{
    machine: MachineDisplayRenderable;
    readinessTestID?: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const presence = resolveMachinePickerPresence(props.machine);
    const readinessState = presence.selectable ? 'ready' : presence.status;
    return (
        <View
            testID={props.readinessTestID}
            {...({
                'data-state': readinessState,
                ...(Platform.OS === 'web' ? { dataSet: { state: readinessState } } : {}),
            } as Record<string, unknown>)}
        >
            <StatusDot
                color={presence.selectable ? theme.colors.status.connected : theme.colors.status.disconnected}
            />
        </View>
    );
}

export type MachineSelectionRowAccessoryProps<TMachine extends MachineDisplayRenderable = Machine> = Readonly<{
    machine: TMachine;
    serverId?: string | null;
    showCliGlyphs: boolean;
    autoDetectCliGlyphs: boolean;
    showFavoriteToggle: boolean;
    isFavorite: boolean;
    onToggleFavorite?: (machine: TMachine) => void;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    favoriteButton: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
    },
}));

export function MachineSelectionRowAccessory<TMachine extends MachineDisplayRenderable = Machine>(
    props: MachineSelectionRowAccessoryProps<TMachine>,
): React.ReactElement | null {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const selectedColor = theme.dark ? theme.colors.text.primary : theme.colors.button.primary.background;

    const handleToggleFavorite = React.useCallback((event?: AccessoryPressEvent) => {
        event?.stopPropagation?.();
        event?.nativeEvent?.stopImmediatePropagation?.();
        props.onToggleFavorite?.(props.machine);
    }, [props]);

    const showFavoriteToggle = props.showFavoriteToggle && props.onToggleFavorite !== undefined;
    if (!props.showCliGlyphs && !showFavoriteToggle) return null;

    return (
        <View style={styles.container}>
            {props.showCliGlyphs ? (
                <MachineCliGlyphs
                    machineId={props.machine.id}
                    serverId={props.serverId}
                    isOnline={isMachineOnline(props.machine)}
                    autoDetect={props.autoDetectCliGlyphs}
                />
            ) : null}
            {showFavoriteToggle ? (
                <Pressable
                    hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                    onPress={handleToggleFavorite}
                    style={styles.favoriteButton}
                    accessibilityRole="button"
                    accessibilityLabel={props.isFavorite
                        ? t('newSession.pathPicker.favoriteRemove')
                        : t('newSession.pathPicker.favoriteAdd')}
                >
                    <Icon
                        name="star"
                        size={20}
                        color={props.isFavorite ? selectedColor : theme.colors.text.secondary}
                        weight={props.isFavorite ? 'fill' : 'regular'}
                    />
                </Pressable>
            ) : null}
        </View>
    );
}
