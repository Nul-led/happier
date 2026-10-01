import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { t } from '@/text';

/**
 * The closing actions of a profile editor that has no host header to carry them: one primary save
 * (Save as for a built-in profile, which saves a copy), then a quiet Cancel.
 */
export function ProfileEditActions(props: Readonly<{
    saveAs: boolean;
    onSave: () => void;
    onCancel: () => void;
}>) {
    return (
        <View style={styles.row}>
            <RoundButton
                testID="profile-edit-save"
                size="normal"
                title={props.saveAs ? t('common.saveAs') : t('common.save')}
                onPress={props.onSave}
            />
            <RoundButton
                testID="profile-edit-cancel"
                size="normal"
                display="secondary"
                title={t('common.cancel')}
                onPress={props.onCancel}
            />
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
    },
}));
