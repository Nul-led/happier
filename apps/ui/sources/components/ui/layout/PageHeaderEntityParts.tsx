import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';

/** One rare operation in an entity page's `⋯` menu. */
export type PageHeaderMenuAction = Readonly<{
    id: string;
    title: string;
    testID?: string;
    disabled?: boolean;
    /** An irreversible operation (delete, clear history): shown in the danger tone. */
    destructive?: boolean;
    /** The operation is running: the row shows progress and cannot be chosen again. */
    loading?: boolean;
    onSelect: () => void | Promise<void>;
}>;

/**
 * The mark at the head of an entity page (agent logo, machine glyph, avatar). `size="row"` is the same
 * mark at the head of a row that stands for an entity inside a page (a service at the top of its
 * sheet, a mark in an add invitation).
 *
 * A real mark — a logo, a monogram, a palette preview — sits on a borderless filled shape. A plain
 * glyph (`appearance="glyph"`) stands alone on the paper: a bordered or filled tile around an ordinary
 * icon is decoration, not identity. Either way the mark keeps the tile's height, so a header or row
 * does not change size with the kind of mark it carries, and its leading edge is the content edge.
 */
export function PageHeaderMarkTile(props: Readonly<{
    children: React.ReactNode;
    testID?: string;
    size?: 'page' | 'row';
    appearance?: 'mark' | 'glyph';
}>) {
    const row = props.size === 'row';
    const glyph = props.appearance === 'glyph';
    return (
        <View
            testID={props.testID}
            style={[
                glyph ? stylesheet.glyph : stylesheet.markTile,
                row ? (glyph ? stylesheet.glyphRow : stylesheet.markTileRow) : null,
            ]}
        >
            {props.children}
        </View>
    );
}

/**
 * An entity page's `⋯` menu of rare operations, placed in `PageHeader` `actions`. `testID` names the
 * menu; its trigger is `<testID>.trigger`.
 */
export const PageHeaderMenu = React.memo(function PageHeaderMenu(props: Readonly<{
    actions: readonly PageHeaderMenuAction[];
    testID?: string;
    /** Overrides the trigger's test id (kept for pages with an established one). */
    triggerTestID?: string;
}>) {
    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(false);
    const items = React.useMemo((): ReadonlyArray<DropdownMenuItem> => props.actions.map((action) => ({
        id: action.id,
        title: action.title,
        ...(action.testID ? { testID: action.testID } : {}),
        ...(action.disabled || action.loading ? { disabled: true } : {}),
        ...(action.destructive ? { destructive: true } : {}),
        ...(action.loading ? { rightElement: <ActivitySpinner size="small" color={theme.colors.text.secondary} /> } : {}),
    })), [props.actions, theme.colors.text.secondary]);
    return (
        <DropdownMenu
            testID={props.testID}
            open={open}
            onOpenChange={setOpen}
            items={items}
            onSelect={(id) => {
                setOpen(false);
                return props.actions.find((action) => action.id === id)?.onSelect();
            }}
            placement="bottom"
            popoverAnchorAlign="end"
            variant="slim"
            matchTriggerWidth={false}
            maxWidthCap={260}
            showCategoryTitles={false}
            popoverPortalWebTarget="body"
            trigger={({ toggle }) => (
                <Pressable
                    testID={props.triggerTestID ?? (props.testID ? `${props.testID}.trigger` : undefined)}
                    onPress={toggle}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.moreActions')}
                    hitSlop={8}
                    style={({ pressed }) => [stylesheet.menuTrigger, pressed ? { backgroundColor: theme.colors.surface.pressed } : null]}
                >
                    <Icon name="dots-three" size={18} color={theme.colors.text.secondary} />
                </Pressable>
            )}
        />
    );
});

/**
 * An entity page's one state control ("Enabled"), placed in `PageHeader` `actions` beside the `⋯` menu:
 * a quiet label and the switch it names.
 */
export const PageHeaderStateSwitch = React.memo(function PageHeaderStateSwitch(props: Readonly<{
    label: string;
    value: boolean | undefined;
    onValueChange: (next: boolean) => void;
    disabled?: boolean;
    /**
     * A change is being saved: the switch keeps its place and value, cannot be flipped again, and
     * announces itself busy (no spinner swapped in, so the header does not move).
     */
    busy?: boolean;
    /** Test id of the switch; the label and switch together are `<testID>.control`. */
    testID?: string;
    /** Names the switch; defaults to the label. */
    accessibilityLabel?: string;
    accessibilityHint?: string;
}>) {
    return (
        <View testID={props.testID ? `${props.testID}.control` : undefined} style={stylesheet.stateSwitch}>
            <Text style={stylesheet.stateSwitchLabel}>{props.label}</Text>
            <Switch
                testID={props.testID}
                value={props.value}
                disabled={props.disabled === true || props.busy === true}
                onValueChange={props.onValueChange}
                accessibilityLabel={props.accessibilityLabel ?? props.label}
                accessibilityHint={props.accessibilityHint}
                accessibilityState={props.busy === undefined ? undefined : {
                    disabled: props.disabled === true || props.busy === true,
                    busy: props.busy,
                }}
            />
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    markTile: {
        width: 44,
        height: 44,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface.inset,
        overflow: 'hidden',
    },
    markTileRow: {
        width: 36,
        height: 36,
        borderRadius: 9,
    },
    glyph: {
        height: 44,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    glyphRow: {
        height: 36,
    },
    stateSwitch: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    // The header's meta line type (`PageHeader` `metaText`): quiet, beside the control it names.
    stateSwitchLabel: {
        ...Typography.default('regular'),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
    },
    menuTrigger: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
