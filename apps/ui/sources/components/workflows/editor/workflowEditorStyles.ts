import { Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Typography } from '@/constants/Typography';

/**
 * Text-labelled authoring controls cannot declare a square the way
 * `IconButton` does, so they take the canonical platform target as a real
 * minimum height. `hitSlop` is not an option: react-native-web's `Pressable`
 * never reads it and the desktop app IS the web bundle, so a slop-declared
 * target there is a target that does not exist. Growth is on the free vertical
 * axis, so wrapping chip rows still meet at their gap rather than overlapping.
 */
const MINIMUM_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

/**
 * Shared editor rhythm.
 *
 * The execution rail — one quiet leading hairline that connects ordered work and
 * folds into a group summary — is this feature's visual signature. Structure is
 * carried by whitespace, alignment and that rail rather than by nesting a card
 * inside a card. Every value comes from the existing theme tokens; this module
 * introduces no palette, font or spacing system of its own.
 */
export const workflowEditorStyles = StyleSheet.create((theme) => ({
    /** The real press frame for a text-labelled authoring control. */
    actionTarget: {
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
    },
    blockList: {
        gap: theme.margins.lg,
    },
    nestedList: {
        gap: theme.margins.md,
    },
    railRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
    },
    rail: {
        width: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border.default,
        marginRight: theme.margins.md,
    },
    railSelected: {
        backgroundColor: theme.colors.border.focus,
    },
    blockBody: {
        flex: 1,
        gap: theme.margins.sm,
    },
    heading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
    },
    ordinal: {
        ...Typography.default('semiBold'),
        ...Typography.tabular(),
        color: theme.colors.text.secondary,
        // A stable ordinal width keeps renumbering from moving the prompt edge.
        minWidth: 18,
    },
    headingName: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    headingNameInput: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        flexGrow: 1,
        flexShrink: 1,
        paddingVertical: theme.margins.xs,
    },
    headingActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.xs,
        marginLeft: 'auto',
    },
    // The canonical composer owns the prompt field's own chrome and focus
    // treatment; this frame only positions it inside the step row.
    promptFrame: {
        position: 'relative',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: theme.margins.sm,
    },
    metaText: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    metaAction: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
    },
    issueText: {
        ...Typography.default('regular'),
        color: theme.colors.text.destructive,
    },
    groupHeading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
    },
    groupSummary: {
        ...Typography.default('regular'),
        color: theme.colors.text.tertiary,
    },
    branchLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.secondary,
    },
    addRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
    },
    addLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
    },
    menuSurface: {
        backgroundColor: theme.colors.surface.elevated,
        borderRadius: theme.borderRadius.xl,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.surface,
        paddingVertical: theme.margins.xs,
        minWidth: 200,
    },
    menuRow: {
        paddingHorizontal: theme.margins.lg,
        paddingVertical: theme.margins.md,
        minHeight: MINIMUM_TARGET_SIZE,
        justifyContent: 'center',
    },
    menuRowPressed: {
        backgroundColor: theme.colors.surface.pressed,
    },
    menuRowLabel: {
        ...Typography.default('regular'),
        color: theme.colors.text.primary,
    },
    inlineControl: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        paddingVertical: theme.margins.xs,
    },
    inlineValue: {
        ...Typography.default('regular'),
        ...Typography.tabular(),
        color: theme.colors.text.primary,
        backgroundColor: theme.colors.input.background,
        borderRadius: theme.borderRadius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.surface,
        paddingHorizontal: theme.margins.sm,
        paddingVertical: theme.margins.xs,
        minWidth: 72,
    },
}));
