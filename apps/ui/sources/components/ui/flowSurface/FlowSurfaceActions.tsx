import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';

import { FLOW_SURFACE_CONTENT_INSET } from './FlowSurfaceChrome';

export type FlowSurfaceAction = Readonly<{
    testID?: string;
    label: string;
    onPress: () => void | Promise<void>;
    disabled?: boolean;
    loading?: boolean;
    display?: 'default' | 'inverted';
}>;

export type FlowSurfaceActionsProps = Readonly<{
    primary: FlowSurfaceAction;
    secondary?: FlowSurfaceAction;
}>;

const stylesheet = StyleSheet.create({
    container: {
        // The actions belong to the card's content column, not to its edges.
        paddingHorizontal: FLOW_SURFACE_CONTENT_INSET,
        paddingBottom: FLOW_SURFACE_CONTENT_INSET,
        gap: 12,
    },
});

export function FlowSurfaceActions(props: FlowSurfaceActionsProps) {
    const styles = stylesheet;

    return (
        <View style={styles.container}>
            <RoundButton
                testID={props.primary.testID}
                title={props.primary.label}
                action={() => Promise.resolve(props.primary.onPress())}
                size="normal"
                disabled={props.primary.disabled}
                loading={props.primary.loading}
            />
            {props.secondary ? (
                <RoundButton
                    testID={props.secondary.testID}
                    title={props.secondary.label}
                    action={() => Promise.resolve(props.secondary!.onPress())}
                    size="normal"
                    display={props.secondary.display ?? 'inverted'}
                    disabled={props.secondary.disabled}
                    loading={props.secondary.loading}
                />
            ) : null}
        </View>
    );
}
