import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';

import { ARTIFACT_KIND_ICONS } from './artifactKindPresentation';

/**
 * The Artifacts empty state's identity: three real kind marks (a document, code, a board) fanned like
 * saved pages. Static, decorative and hidden from assistive technology; the title carries the meaning.
 */
export function ArtifactsEmptyMark(): React.ReactElement {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    return (
        <View style={styles.stage} accessible={false} importantForAccessibility="no-hide-descendants">
            <View style={[styles.page, styles.left]}><Icon name={ARTIFACT_KIND_ICONS.document} size={22} color={theme.colors.text.secondary} /></View>
            <View style={[styles.page, styles.right]}><Icon name={ARTIFACT_KIND_ICONS.board} size={22} color={theme.colors.text.secondary} /></View>
            <View style={[styles.page, styles.center]}><Icon name="code" size={22} color={theme.colors.text.secondary} /></View>
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    stage: {
        width: 132,
        height: 84,
    },
    page: {
        position: 'absolute',
        top: 10,
        width: 56,
        height: 68,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface.base,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
    },
    left: {
        left: 0,
        transform: [{ rotate: '-8deg' }],
    },
    right: {
        right: 0,
        transform: [{ rotate: '8deg' }],
    },
    center: {
        left: 38,
        top: 0,
    },
}));
