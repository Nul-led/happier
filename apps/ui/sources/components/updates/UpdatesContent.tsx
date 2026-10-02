import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { MENU_ROW_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { UpdatesContentModel, UpdatesGroup } from '@/updates/useUpdatesContentModel';

import { describeUpdatesHeader } from './describeUpdatesSummary';
import { UpdateRow } from './UpdateRow';
import { UpdatesPopoverRows } from './UpdatesPopoverRows';
import { UpdatesTextButton } from './UpdatesTextButton';

type Presentation = 'popover' | 'screen';

/**
 * A section title, in the page and the popover alike: sentence case (DESIGN.md "Configuration
 * surfaces"), then the machine's own name with its case preserved (hostnames are case-meaningful).
 */
function groupPageTitle(group: UpdatesGroup): string {
    if (group.kind === 'app') return t('updates.sections.thisApp');
    const label = group.kind === 'thisComputer' ? t('updates.sections.thisComputer') : t('updates.sections.machine');
    return group.machineName ? `${label} · ${group.machineName}` : label;
}

function groupWhere(group: UpdatesGroup): string {
    if (group.kind === 'app') return t('updates.sections.thisApp');
    if (group.kind === 'thisComputer') return group.machineName ?? t('updates.sections.thisComputer');
    return group.machineName ?? '';
}

/** Check for updates, and the one batch action: the screen puts them in the page header. */
const SummaryActions = React.memo(function SummaryActions(props: Readonly<{ model: UpdatesContentModel; presentation: Presentation }>) {
    const { model } = props;
    const header = describeUpdatesHeader(model.summary, model.batch, model);
    return (
        <View style={styles.headerActions}>
            {!model.batch && props.presentation === 'screen' ? (
                <UpdatesTextButton label={t('updates.action.checkNow')} onPress={model.checkNow} testID="updates.checkNow" />
            ) : null}
            {header.showUpdateAll ? (
                <RoundButton size="small" title={t('updates.action.updateAll')} onPress={() => void model.updateAll()} testID="updates.updateAll" />
            ) : header.showStop ? (
                <UpdatesTextButton label={t('updates.action.stopAfterThis')} onPress={model.stopAfterCurrent} testID="updates.stopAfterThis" />
            ) : null}
        </View>
    );
});

const SummaryHeader = React.memo(function SummaryHeader(props: Readonly<{ model: UpdatesContentModel; presentation: Presentation }>) {
    const { model } = props;
    const header = describeUpdatesHeader(model.summary, model.batch, model);
    const compact = props.presentation === 'popover';
    return (
        <View style={[styles.header, compact ? styles.headerCompact : styles.headerComfortable]} testID="updates.summary">
            {/*
              * One polite live region for the whole status: a completion or failure changes the
              * title, so it is announced; percent ticks live in the rows and never reach it. The
              * block's minimum height (one title line + one meta line) keeps the list from jumping.
              */}
            <View
                style={[styles.headerText, compact ? styles.headerTextCompact : styles.headerTextComfortable]}
                accessibilityLiveRegion="polite"
            >
                <Text
                    style={[styles.headerTitle, compact ? styles.headerTitleCompact : null]}
                    accessibilityRole="header"
                    numberOfLines={compact ? 2 : undefined}
                    testID="updates.summary.title"
                >
                    {header.title}
                </Text>
                <Text style={[styles.headerMeta, Typography.tabular()]} testID="updates.summary.meta">
                    {header.meta}
                </Text>
            </View>
            {compact ? <SummaryActions model={model} presentation={props.presentation} /> : null}
        </View>
    );
});

const UpdatesGroupSection = React.memo(function UpdatesGroupSection(props: Readonly<{
    model: UpdatesContentModel;
    group: UpdatesGroup;
    secondaryActions: boolean;
}>) {
    const { theme } = useUnistyles();
    const { model, group } = props;
    const where = groupWhere(group);
    const skipVersion = group.kind === 'app' ? model.skipAppVersion : null;
    return (
        <View testID={`updates.section.${group.id}`}>
            <ItemGroup
                title={groupPageTitle(group)}
                {...(!group.online ? { description: t('updates.offline') } : {})}
            >
                {group.items.map((item) => (
                    <UpdateRow
                        key={item.id}
                        item={item}
                        where={where}
                        presentation="screen"
                        secondaryAction={props.secondaryActions}
                        onRun={model.runItem}
                        onLongPress={skipVersion ?? undefined}
                        isThisComputer={group.kind === 'thisComputer'}
                        sessionsRunning={item.machineId != null && model.sessionsRunningOn.has(item.machineId)}
                    />
                ))}
                {skipVersion ? (
                    <Item
                        title={t('updates.action.skipVersion')}
                        icon={<Icon name="x" size={ICON_SIZE.xl} color={theme.colors.text.secondary} />}
                        onPress={skipVersion}
                        showChevron={false}
                        testID="updates.skipVersion"
                    />
                ) : null}
                {group.kind === 'app' ? (
                    <Item
                        title={t('updates.action.whatsNew')}
                        icon={<Icon name="sparkle" size={ICON_SIZE.xl} color={theme.colors.text.secondary} />}
                        onPress={model.openWhatsNew}
                        testID="updates.whatsNew"
                    />
                ) : null}
            </ItemGroup>
        </View>
    );
});

/**
 * Updates in two densities, exactly like the inbox: `popover` (sidebar pill) and `screen`
 * (Settings › Updates). One list — This app → This computer → other machines — whose groups and
 * rows never re-sort by state, so nothing jumps while updates land.
 */
export const UpdatesContent = React.memo(function UpdatesContent(props: Readonly<{
    model: UpdatesContentModel;
    presentation: Presentation;
}>) {
    const { model, presentation } = props;
    const compact = presentation === 'popover';
    // Only one filled button is the primary: when "Update all" shows, row buttons are secondary.
    const secondaryActions = model.summary.actionableCount >= 2 && !model.batch;
    // The calm empty state only when every row proved it is current (the header's own decision).
    const nothingToShow = compact
        && describeUpdatesHeader(model.summary, model.batch, model).empty
        && !model.whatsNewUnread;

    return (
        <View style={[styles.content, compact ? styles.compactContent : null]} testID={`updates.content.${presentation}`}>
            {nothingToShow ? (
                <View style={[styles.empty, compact ? styles.emptyCompact : null]}>
                    <EmptyState
                        testID="updates.empty"
                        iconName="check-circle"
                        title={describeUpdatesHeader(model.summary, model.batch, model).title}
                        subtitle={model.summary.status === 'unknown'
                            ? t('updates.summary.unknownDescription')
                            : model.summary.status === 'offline'
                                ? t('updates.summary.offlineDescription')
                                : t('updates.summary.upToDateDescription')}
                        action={<UpdatesTextButton label={t('updates.action.checkNow')} onPress={model.checkNow} testID="updates.empty.checkNow" />}
                    />
                </View>
            ) : (
                <>
                    {!compact ? (
                        <SettingsPageHeader
                            description={t('updates.pageDescription')}
                            actions={<SummaryActions model={model} presentation={presentation} />}
                        />
                    ) : null}
                    <SummaryHeader model={model} presentation={presentation} />
                    {compact ? (
                        <UpdatesPopoverRows model={model} />
                    ) : model.groups.map((group) => (
                        <UpdatesGroupSection
                            key={group.id}
                            model={model}
                            group={group}
                            secondaryActions={secondaryActions}
                        />
                    ))}
                    {!compact ? <Text style={styles.footer}>{t('updates.footer')}</Text> : null}
                </>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    content: {
        width: '100%',
        paddingBottom: 24,
    },
    // The popover's rows and footer carry the menu rhythm (`MENU_ROW_METRICS`); nothing extra below.
    compactContent: {
        paddingBottom: 0,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.md,
    },
    // The summary line starts on the menu rows' text edge and sits one menu rhythm above them.
    headerCompact: {
        paddingHorizontal: MENU_ROW_METRICS.insetPx + MENU_ROW_METRICS.paddingHorizontalPx,
        paddingTop: MENU_ROW_METRICS.sectionPaddingVerticalPx + MENU_ROW_METRICS.paddingVerticalPx,
        paddingBottom: MENU_ROW_METRICS.paddingVerticalPx,
    },
    headerComfortable: {
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        paddingTop: 16,
        paddingBottom: 4,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
        justifyContent: 'center',
        gap: 2,
    },
    // One title line + one meta line: the floor every state lays out on.
    headerTextCompact: {
        minHeight: Platform.select({ ios: 19, default: 18 }) + 2 + 16,
    },
    headerTextComfortable: {
        minHeight: Platform.select({ ios: 22, default: 21 }) + 2 + 16,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.md,
    },
    headerTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: Platform.select({ ios: 17, default: 16 }),
        lineHeight: Platform.select({ ios: 22, default: 21 }),
    },
    headerTitleCompact: {
        fontSize: Platform.select({ ios: 14, default: 13 }),
        lineHeight: Platform.select({ ios: 19, default: 18 }),
    },
    headerMeta: {
        ...Typography.timestamp(),
        color: theme.colors.text.secondary,
    },
    footer: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        paddingTop: 8,
    },
    empty: {
        minHeight: 320,
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingVertical: 48,
    },
    emptyCompact: {
        minHeight: 220,
        paddingVertical: 34,
    },
}));
