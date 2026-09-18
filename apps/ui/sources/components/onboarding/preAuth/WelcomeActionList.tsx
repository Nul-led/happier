import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export type WelcomeActionAdmission = Readonly<{
    pendingActionId: string | null;
    run: (actionId: string, action: () => Promise<void> | void) => Promise<void>;
}>;

export const WelcomeActionAdmissionContext = React.createContext<WelcomeActionAdmission>({
    pendingActionId: null,
    run: async (_actionId, action) => { await action(); },
});

export const WelcomeActionList = React.memo(function WelcomeActionList(props: Readonly<{
    children: React.ReactNode;
    admission: WelcomeActionAdmission;
    compact?: boolean;
}>) {
    return (
        <WelcomeActionAdmissionContext.Provider value={props.admission}>
            <View style={props.compact ? styles.compact : styles.root}>{props.children}</View>
        </WelcomeActionAdmissionContext.Provider>
    );
});

const styles = StyleSheet.create(() => ({
    root: { gap: 12, width: '100%' },
    compact: { gap: 10, width: '100%' },
}));
