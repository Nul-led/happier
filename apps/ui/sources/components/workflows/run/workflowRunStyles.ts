import { Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Typography } from '@/constants/Typography';

/**
 * Text-labelled controls cannot declare a square the way `IconButton` does, so
 * they take the platform target as a real minimum height. `hitSlop` is not an
 * option: react-native-web's `Pressable` never reads it, and the desktop app IS
 * the web bundle. Growth is on the free vertical axis only, so wrapping rows
 * still meet at their gap instead of overlapping.
 */
const MINIMUM_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

/**
 * Shared Run-detail rhythm.
 *
 * One owner so the outcome region, the invocation outline and the selected
 * invocation detail read as one object rather than three surfaces that happen
 * to sit on the same screen. Every value comes from existing theme tokens; this
 * module introduces no palette, font or spacing system of its own.
 */
export const workflowRunStyles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    /**
     * The outline and, on wide layouts, its neighbouring inspector. The grid
     * owns the readable width so the inspector sits beside the outline it
     * describes rather than at the far edge of a wide window; each column
     * scrolls on its own, which is what keeps the inspector in place while the
     * outline scrolls.
     */
    grid: {
        flex: 1,
        flexDirection: 'row',
        alignSelf: 'center',
        width: '100%',
    },
    outline: {
        flex: 1,
        minWidth: 0,
    },
    inspector: {
        flexBasis: 360,
        flexGrow: 0,
        flexShrink: 0,
        maxWidth: 480,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: theme.colors.border.default,
    },
    inspectorContent: {
        paddingHorizontal: theme.margins.lg,
        paddingVertical: theme.margins.lg,
    },
    root: {
        gap: theme.margins.lg,
    },
    outcome: {
        gap: theme.margins.sm,
    },
    pageTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    /**
     * The completion moment's visible half: a brief semantic success wash on
     * the existing outcome surface, using only existing state color roles. It
     * is what pairs with `hapticsLight`, and reduced motion omits it because
     * the status change alone already tells the same truth.
     */
    outcomeCompleted: {
        backgroundColor: theme.colors.state.success.background,
        borderRadius: theme.borderRadius.xl,
        paddingHorizontal: theme.margins.md,
        paddingVertical: theme.margins.sm,
        marginHorizontal: -theme.margins.md,
        marginVertical: -theme.margins.sm,
    },
    outcomeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
    },
    outcomeSentence: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    provenance: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.md,
        flexWrap: 'wrap',
    },
    actionTarget: {
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
    },
    action: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
    },
    section: {
        gap: theme.margins.sm,
    },
    sectionLabel: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    attentionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        paddingVertical: theme.margins.sm,
        minHeight: MINIMUM_TARGET_SIZE,
    },
    attentionLabel: {
        ...Typography.default('regular'),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
    },
    detailKey: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    detailValue: {
        ...Typography.mono(),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    metric: {
        ...Typography.default('regular'),
        ...Typography.tabular(),
        color: theme.colors.text.secondary,
    },
}));
