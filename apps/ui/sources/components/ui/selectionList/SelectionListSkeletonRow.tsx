import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { HappierSkeletonBlock } from '@happier-dev/plugin-ui/presentation';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

import { SELECTION_LIST_SKELETON_ROW_HEIGHT_PX } from './_constants';

/**
 * Placeholder row for dynamic-section loading in selection lists. The bar and
 * its pulse are drawn by the ONE shared skeleton owner
 * (`HappierSkeletonBlock`, extracted from this file), which runs the 0.4 ↔ 0.8
 * opacity pulse off the JavaScript thread and holds a static bar under reduced
 * motion. This row only owns the list geometry around it.
 *
 * Width varies per row (50% / 80% / 65% cycle) so consecutive rows feel like
 * real content with different label lengths instead of a uniform bar.
 *
 * The outer container is hidden from assistive tech on every platform via the
 * R16d trio (`aria-hidden` for web, `accessibilityElementsHidden` for iOS,
 * `importantForAccessibility="no-hide-descendants"` for Android) so assistive
 * tech doesn't announce skeleton chrome.
 */

const SKELETON_HEIGHT_PX = 16;
const SKELETON_HORIZONTAL_MARGIN_PX = 16;
const SKELETON_BORDER_RADIUS_PX = 6;
const SKELETON_WIDTH_PERCENTAGES: ReadonlyArray<number> = [50, 80, 65, 72, 58];

const stylesheet = StyleSheet.create({
    // R13 (Fix 5): the OUTER container reserves the same vertical footprint
    // the rendered option row will eventually use. Without this, loading→ready
    // shifts the popover layout downwards by the (rowHeight - shimmerHeight)
    // delta. The shimmer bar centers within the reserved height.
    container: {
        height: SELECTION_LIST_SKELETON_ROW_HEIGHT_PX,
        justifyContent: 'center',
    },
    bar: {
        marginHorizontal: SKELETON_HORIZONTAL_MARGIN_PX,
    },
});

export type SelectionListSkeletonRowProps = Readonly<{
    /** Row index — drives the cycling width pattern so rows feel natural. */
    index: number;
    testID?: string;
}>;

export function SelectionListSkeletonRow(
    props: SelectionListSkeletonRowProps,
): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const reducedMotion = useReducedMotionPreference();

    const widthPercent = SKELETON_WIDTH_PERCENTAGES[
        props.index % SKELETON_WIDTH_PERCENTAGES.length
    ] ?? 70;

    return (
        <View
            testID={props.testID}
            style={styles.container}
            // R16d (Fix 2): hide the loading skeleton from assistive tech on
            // every platform. Web honors `aria-hidden`; iOS reads
            // `accessibilityElementsHidden`; Android reads
            // `importantForAccessibility="no-hide-descendants"`.
            aria-hidden={true}
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
        >
            <HappierSkeletonBlock
                testID={props.testID ? `${props.testID}:bar` : undefined}
                color={theme.colors.surface.pressedOverlay}
                width={`${widthPercent}%`}
                height={SKELETON_HEIGHT_PX}
                radius={SKELETON_BORDER_RADIUS_PX}
                reducedMotion={reducedMotion}
                style={styles.bar}
            />
        </View>
    );
}
