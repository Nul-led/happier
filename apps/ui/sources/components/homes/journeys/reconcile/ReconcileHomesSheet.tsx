import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';

import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { HeaderLogo } from '@/components/ui/navigation/HeaderLogo';
import { HomeMark } from '@/components/homes/HomeMark';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import type { CustomModalInjectedProps } from '@/modal/types';
import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { buildMachineAddHref } from '@/components/settings/machines/collection/machineCollectionModel';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { PaneConfirmed } from '../alreadyUse/journeyPaneKit';
import { useHomesReconcileState } from '../useHomesJourneyState';
import { EmptyPersonalHomeOption, useEmptyPersonalHomeChoice } from './EmptyPersonalHomeOption';

function profileById(profiles: readonly ServerProfile[], id: string): ServerProfile | null {
    return profiles.find((profile) => resolveServerProfileScopeId(profile) === id) ?? null;
}

/**
 * "Your Homes are connected" (J2): shown when a sign-in, a Home link or an address connected Homes
 * beside the Personal Home this computer made. It confirms what already happened, then asks the one
 * real decision — where this computer's new sessions go — with "Keep both" always there. "Use …"
 * focuses that Home and hands over to this computer's setup for it (the canonical machine setup
 * owner, which moves or adds this computer's background service). Removing the empty Personal Home
 * is offered only when the Home says it is empty.
 */
export function ReconcileHomesSheet(props: CustomModalInjectedProps) {
    const { offer, profiles, settle } = useHomesReconcileState();
    const found = React.useMemo(
        () => (offer?.foundHomeIds ?? []).map((id) => profileById(profiles, id)).filter((profile): profile is ServerProfile => profile !== null),
        [offer, profiles],
    );
    const personal = offer ? profileById(profiles, offer.personalHomeId) : null;
    if (found.length === 0) {
        // Settled elsewhere (or the Homes went away) while the sheet was open.
        return null;
    }
    return <ReconcileHomesContent found={found} personal={personal} settle={settle} onClose={props.onClose} />;
}

/** The sheet's body for a known set of found Homes (the Personal Home last among the choices). */
export function ReconcileHomesContent(props: Readonly<{
    found: readonly ServerProfile[];
    personal: ServerProfile | null;
    settle: () => void;
    onClose: () => void;
}>) {
    const router = useRouter();
    const { found, personal, settle, onClose } = props;
    const choices = React.useMemo(() => [...found, ...(personal ? [personal] : [])], [found, personal]);
    const [runInId, setRunInId] = React.useState<string | null>(null);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const emptyChoice = useEmptyPersonalHomeChoice(personal);
    const selectedId = runInId ?? (found[0] ? resolveServerProfileScopeId(found[0]) : null);
    const selected = selectedId ? profileById(choices, selectedId) : null;
    const selectedIsPersonal = Boolean(personal && selected && resolveServerProfileScopeId(personal) === selectedId);

    const keepBoth = React.useCallback(() => {
        settle();
        onClose();
    }, [onClose, settle]);
    const useSelected = React.useCallback(async () => {
        if (!selected || busy) return;
        setBusy(true);
        try {
            settle();
            const switched = await setActiveServerAndSwitch({ serverId: selected.id, scope: 'device' });
            onClose();
            if (switched === 'blocked') return;
            // Only once this computer has left it: the empty Personal Home, when chosen, goes.
            await emptyChoice.commit();
            const navigation = runGuardedNavigation(() => router.push(buildMachineAddHref({ path: 'thisComputer' }) as never));
            if (navigation !== true) fireAndForget(navigation, { tag: 'ReconcileHomesSheet.setupThisComputer' });
        } finally {
            setBusy(false);
        }
    }, [busy, emptyChoice, onClose, router, selected, settle]);

    const menuItems = choices.map((profile) => ({
        id: resolveServerProfileScopeId(profile),
        title: resolveHomeDisplayLabel(profile, profile.id),
        icon: <HomeMark serverUrl={profile.canonicalServerUrl ?? profile.serverUrl} />,
    }));

    return (
        <View style={styles.body} testID="reconcile-homes">
            <ItemGroup title={t('homesJourneys.reconcileFound')}>
                {found.map((profile) => {
                    const id = resolveServerProfileScopeId(profile);
                    const label = resolveHomeDisplayLabel(profile, profile.id);
                    return (
                        <Item
                            key={id}
                            testID={`reconcile-homes.found.${id}`}
                            icon={<HomeMark serverUrl={profile.canonicalServerUrl ?? profile.serverUrl} />}
                            title={label}
                            subtitle={toServerUrlDisplay(profile.canonicalServerUrl ?? profile.serverUrl)}
                            showChevron={false}
                            rightElement={<PaneConfirmed label={t('homesJourneys.connected')} />}
                        />
                    );
                })}
            </ItemGroup>
            <ItemGroup title={t('homesJourneys.reconcileThisComputer')}>
                <DropdownMenu
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                    items={menuItems}
                    selectedId={selectedId}
                    onSelect={(id) => setRunInId(id)}
                    itemTrigger={{
                        title: t('homesJourneys.runSessionsIn'),
                        subtitle: t('homesJourneys.runSessionsInDescription'),
                        showSelectedSubtitle: false,
                        itemProps: { testID: 'reconcile-homes.run-in', accessoryLayout: 'adaptive' },
                    }}
                />
            </ItemGroup>
            <EmptyPersonalHomeOption choice={emptyChoice} detail={t('homesJourneys.removeEmptyPersonalHomeDescription')} />
            <View style={styles.footer}>
                <Text style={styles.footerNote}>{t('homesJourneys.changeLater')}</Text>
                <View style={styles.footerActions}>
                    <RoundButton
                        testID="reconcile-homes.keep-both"
                        size="small"
                        display="secondary"
                        title={t('homesJourneys.keepBoth')}
                        onPress={keepBoth}
                    />
                    {selected && !selectedIsPersonal ? (
                        <RoundButton
                            testID="reconcile-homes.use"
                            size="small"
                            title={t('homesJourneys.useHome', { home: resolveHomeDisplayLabel(selected, selected.id) })}
                            loading={busy}
                            onPress={() => { void useSelected(); }}
                        />
                    ) : null}
                </View>
            </View>
        </View>
    );
}

/** Opens the sheet: automatically right after a sign-in connected Homes, or from its setup tile. */
export function presentReconcileHomesSheet(input: Readonly<{ foundCount: number }>): string {
    return Modal.show({
        component: ReconcileHomesSheet,
        closeOnBackdrop: true,
        chrome: {
            kind: 'card',
            leading: <HeaderLogo size={32} />,
            title: t('homesJourneys.reconcileTitle'),
            subtitle: t('homesJourneys.reconcileLead', { count: input.foundCount }),
            dimensions: { width: 560 },
            testID: 'reconcile-homes-sheet',
        },
    });
}

const styles = StyleSheet.create((theme) => ({
    body: {
        paddingBottom: 16,
    },
    footer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 8,
    },
    footerNote: {
        ...Typography.default(),
        flex: 1,
        minWidth: 160,
        fontSize: 12.5,
        lineHeight: 17,
        color: theme.colors.text.secondary,
    },
    footerActions: {
        flexDirection: 'row',
        gap: 8,
    },
}));
