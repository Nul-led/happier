import * as React from 'react';
import { useRouter } from 'expo-router';

import type { SetupBlockItem } from '@/components/ui/setupBlocks/SetupBlockGrid';
import { SetupBlockTile } from '@/components/ui/setupBlocks/SetupBlockTile';
import { homeAdministrationRuntimePath } from '@/components/settings/home/governance/homeAdministrationRoutes';
import { HomeMark } from '@/components/homes/HomeMark';
import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';
import { resolveServerProfileScopeId } from '@/sync/domains/server/serverProfiles';
import { dismissHomeReachNudge } from '@/sync/runtime/connectivity/homeReachFailures';
import { t } from '@/text';

import { HomeAddForm } from '../add/HomeAddForm';
import { AlreadyUseHappierTile } from './alreadyUse/AlreadyUseHappierTile';
import type { AlreadyUsePath } from './alreadyUse/alreadyUsePaths';
import { LaptopHomeNudgeTile } from './nudge/LaptopHomeNudgeTile';
import { useLaptopHomeNudgeFacts } from './nudge/useLaptopHomeNudgeFacts';
import { presentReconcileHomesSheet } from './reconcile/ReconcileHomesSheet';
import { presentUseServiceAsHomeSheet } from './serviceHome/UseServiceAsHomeSheet';
import { useAlreadyUseHappierOffer, useHomesReconcileState } from './useHomesJourneyState';
import { useJourneyAccountService } from './useJourneyAccountService';

/** Stable ids of the Homes journeys' Get set up items (for the host's dismissed-steps store). */
export const HOMES_JOURNEY_SETUP_ITEM_IDS = Object.freeze({
    alreadyUse: 'homes.alreadyUseHappier',
    reconcile: 'homes.reconcile',
    laptopNudge: 'homes.laptopNudge',
});

/**
 * The Homes journeys' steps for Home's Get set up, in the order they lead it (Direction B): the
 * laptop nudge (only after real missed reaches), the reconcile choice (while a sign-in's Homes are
 * unsettled), then "Already use Happier?" (while this computer uses only its own Personal Home). Each
 * is a `SetupBlockItem`, so "Already use Happier?" grows in place into its panel exactly like the QR
 * tile. Also presents the reconcile sheet once, right after this run connected a Home. Mounted by
 * Home's Get set up (`components/hub`, owned by the Home-index lane).
 */
export function useHomesJourneySetupItems(input: Readonly<{
    /** The host's ✕ for a step, when it lets the person put steps away. */
    onDismiss?: (itemId: string) => void;
    /** Get set up's tiles on a computer, rows on a phone (default `card`). */
    layout?: 'card' | 'row';
}> = {}): readonly SetupBlockItem[] {
    const router = useRouter();
    const service = useJourneyAccountService();
    const alreadyUse = useAlreadyUseHappierOffer();
    const reconcile = useHomesReconcileState();
    const nudge = useLaptopHomeNudgeFacts();
    const pathRef = React.useRef<AlreadyUsePath>('service');
    useAutoPresentReconcile(reconcile);

    const { onDismiss } = input;
    const layout = input.layout ?? 'card';
    const serviceUrl = service.discovery?.endpointUrl ?? service.entry.endpoint.url;
    const openServiceAsHome = React.useCallback(() => {
        presentUseServiceAsHomeSheet({ serviceName: service.name, serviceUrl });
    }, [service.name, serviceUrl]);

    const firstFound = reconcile.offer
        ? reconcile.profiles.find((profile) => resolveServerProfileScopeId(profile) === reconcile.offer?.foundHomeIds[0]) ?? null
        : null;
    const foundCount = reconcile.offer?.foundHomeIds.length ?? 0;

    return React.useMemo(() => {
        const items: SetupBlockItem[] = [];
        if (nudge) {
            items.push({
                id: HOMES_JOURNEY_SETUP_ITEM_IDS.laptopNudge,
                span: 'row',
                renderTile: () => (
                    <LaptopHomeNudgeTile
                        facts={nudge}
                        serviceName={service.hostsHome ? service.name : null}
                        onMoveHome={() => router.push(homeAdministrationRuntimePath(nudge.homeServerId) as never)}
                        onUseService={openServiceAsHome}
                        onDismiss={() => dismissHomeReachNudge(nudge.homeIdentityId)}
                    />
                ),
            });
        }
        if (firstFound) {
            const home = resolveHomeDisplayLabel(firstFound, firstFound.id);
            items.push({
                id: HOMES_JOURNEY_SETUP_ITEM_IDS.reconcile,
                renderTile: () => (
                    <SetupBlockTile
                        testID="homes-reconcile-tile"
                        layout={layout}
                        glyph={<HomeMark serverUrl={firstFound.canonicalServerUrl ?? firstFound.serverUrl} />}
                        title={t('homesJourneys.reconcileSetupTitle')}
                        subtitle={t('homesJourneys.reconcileSetupSubtitle', { home })}
                        action={{
                            label: t('homesJourneys.reconcileSetupAction'),
                            testID: 'homes-reconcile-tile.choose',
                            onPress: () => presentReconcileHomesSheet({ foundCount }),
                        }}
                    />
                ),
            });
        }
        if (alreadyUse) {
            items.push({
                id: HOMES_JOURNEY_SETUP_ITEM_IDS.alreadyUse,
                span: 2,
                renderTile: ({ open }) => (
                    <AlreadyUseHappierTile
                        service={service}
                        onOpenPath={(path) => {
                            pathRef.current = path;
                            open();
                        }}
                        onUseServiceAsHome={openServiceAsHome}
                        onDismiss={onDismiss ? () => onDismiss(HOMES_JOURNEY_SETUP_ITEM_IDS.alreadyUse) : undefined}
                    />
                ),
                renderPanel: ({ close }) => (
                    <HomeAddForm
                        layout="panel"
                        testID="already-use-happier.panel"
                        initialPath={pathRef.current}
                        onClose={close}
                    />
                ),
            });
        }
        return items;
    }, [alreadyUse, firstFound, foundCount, layout, nudge, onDismiss, openServiceAsHome, router, service]);
}

// This app run: a Home saved after it started was connected by something the person just did.
const RUN_STARTED_AT_MS = Date.now();
const presentedThisRun = new Set<string>();

/**
 * Presents the reconcile sheet once, when a Home saved during this app run makes the offer appear —
 * a sign-in, a Home link or an address just connected it, wherever that started; the sheet shows as
 * Home comes back. An offer already standing when the app started stays on its setup tile instead
 * of interrupting.
 */
function useAutoPresentReconcile(state: ReturnType<typeof useHomesReconcileState>): void {
    const { offer, profiles } = state;
    React.useEffect(() => {
        if (!offer) return;
        const fresh = offer.foundHomeIds.filter((id) => {
            if (presentedThisRun.has(id)) return false;
            const profile = profiles.find((candidate) => resolveServerProfileScopeId(candidate) === id);
            return profile !== undefined && profile.createdAt >= RUN_STARTED_AT_MS;
        });
        if (fresh.length === 0) return;
        for (const id of offer.foundHomeIds) presentedThisRun.add(id);
        presentReconcileHomesSheet({ foundCount: offer.foundHomeIds.length });
    }, [offer, profiles]);
}
