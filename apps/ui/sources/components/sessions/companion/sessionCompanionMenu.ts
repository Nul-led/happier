import type { ItemAction } from '@/components/ui/lists/itemActions';
import { t } from '@/text';

import {
    SESSION_SUMMARY_COMPANION_ITEM,
    areSessionCompanionItemsEqual,
    type SessionCompanionDensity,
    type SessionCompanionEdge,
    type SessionCompanionItemRefV1,
    type SessionCompanionPreferenceV1,
} from './state/sessionCompanionPreference';
import type { SessionCompanionAddableItem } from './sessionCompanionContentModel';
import { resolveSessionCompanionPhysicalSide } from './layout/resolveSessionCompanionPlacement';

/**
 * The Companion's reachable controls, built from the controller operations that
 * actually exist for this viewer right now.
 *
 * A controller method with no reachable control is unfinished, and a control with
 * no handler is worse than absent — so every entry here is produced only when its
 * handler was supplied. Applied choices are announced as SELECTED rather than
 * disabled: an already-applied valid value is chosen, not unavailable.
 */

export function buildSessionCompanionMenuActions(input: Readonly<{
    preference: SessionCompanionPreferenceV1;
    /** Current physical reading direction; preferences remain logical. */
    layoutDirection?: 'ltr' | 'rtl';
    /** Currently readable Board items this Companion does not already hold. */
    addableItems: readonly SessionCompanionAddableItem[];
    setEdge: (edge: SessionCompanionEdge) => void;
    setDensity: (density: SessionCompanionDensity) => void;
    setCollapsed: (collapsed: boolean) => void;
    hide: () => void;
    addItem: (item: SessionCompanionItemRefV1) => void;
    openFullSurface?: () => void;
}>): ItemAction[] {
    const actions: ItemAction[] = [];
    const hasSummary = input.preference.items.some(
        (item) => areSessionCompanionItemsEqual(item, SESSION_SUMMARY_COMPANION_ITEM),
    );

    if (!hasSummary) {
        actions.push({
            id: 'add-summary',
            title: t('sessionBoard.companion.actions.addSummary'),
            icon: 'plus',
            onPress: () => input.addItem(SESSION_SUMMARY_COMPANION_ITEM),
        });
    }
    for (const candidate of input.addableItems) {
        actions.push({
            id: `add-${candidate.widgetId}`,
            title: t('sessionBoard.companion.actions.addItem', { title: candidate.title }),
            icon: 'plus',
            onPress: () => input.addItem({ kind: 'widget', widgetId: candidate.widgetId }),
        });
    }

    // Persistence remains logical, while the menu names and icons the physical
    // destination the reader will actually see in the current direction.
    const direction = input.layoutDirection ?? 'ltr';
    const leadingSide = resolveSessionCompanionPhysicalSide('leading', direction);
    const trailingSide = resolveSessionCompanionPhysicalSide('trailing', direction);
    actions.push(
        {
            id: 'edge-leading',
            title: t(leadingSide === 'left'
                ? 'sessionBoard.companion.actions.moveToLeading'
                : 'sessionBoard.companion.actions.moveToTrailing'),
            icon: leadingSide === 'left' ? 'arrow-left' : 'arrow-right',
            selected: input.preference.edge === 'leading',
            onPress: () => input.setEdge('leading'),
        },
        {
            id: 'edge-trailing',
            title: t(trailingSide === 'right'
                ? 'sessionBoard.companion.actions.moveToTrailing'
                : 'sessionBoard.companion.actions.moveToLeading'),
            icon: trailingSide === 'right' ? 'arrow-right' : 'arrow-left',
            selected: input.preference.edge === 'trailing',
            onPress: () => input.setEdge('trailing'),
        },
        {
            id: 'density-compact',
            title: t('sessionBoard.companion.actions.compact'),
            icon: 'list',
            selected: input.preference.density === 'compact',
            onPress: () => input.setDensity('compact'),
        },
        {
            id: 'density-comfortable',
            title: t('sessionBoard.companion.actions.comfortable'),
            icon: 'list',
            selected: input.preference.density === 'comfortable',
            onPress: () => input.setDensity('comfortable'),
        },
    );

    if (input.openFullSurface) {
        actions.push({
            id: 'open-full',
            title: t('sessionBoard.companion.actions.openFull'),
            icon: 'arrows-out',
            onPress: input.openFullSurface,
        });
    }

    actions.push(input.preference.collapsed
        ? {
            id: 'expand',
            title: t('sessionBoard.companion.actions.expand'),
            icon: 'arrows-out',
            onPress: () => input.setCollapsed(false),
        }
        : {
            id: 'collapse',
            title: t('sessionBoard.companion.actions.collapse'),
            icon: 'arrows-in',
            onPress: () => input.setCollapsed(true),
        });

    actions.push({
        id: 'hide',
        title: t('sessionBoard.companion.actions.hide'),
        icon: 'eye-slash',
        onPress: input.hide,
    });

    return actions;
}

/**
 * Per-item local actions. Reorder never depends on drag alone, and removal is
 * deliberately non-destructive wording: it drops this viewer's reference, while
 * deleting the shared record stays in Board/widget management.
 */
export function buildSessionCompanionItemActions(input: Readonly<{
    index: number;
    count: number;
    moveTo: (toIndex: number) => void;
    remove: () => void;
    /** Present only while the Board is currently reachable for this viewer. */
    openOnBoard?: () => void;
}>): ItemAction[] {
    const actions: ItemAction[] = [];
    if (input.index > 0) {
        actions.push({
            id: 'move-up',
            title: t('common.moveUp'),
            icon: 'arrow-up',
            onPress: () => input.moveTo(input.index - 1),
        });
    }
    if (input.index < input.count - 1) {
        actions.push({
            id: 'move-down',
            title: t('common.moveDown'),
            icon: 'arrow-down',
            onPress: () => input.moveTo(input.index + 1),
        });
    }
    // First/last are only distinct once a step and a jump differ; with three or
    // fewer items "move to first" IS "move up", and a menu that says both twice
    // is noise, not reach.
    if (input.count > 3) {
        if (input.index > 1) {
            actions.push({
                id: 'move-first',
                title: t('sessionBoard.companion.actions.moveToFirst'),
                icon: 'arrow-circle-up',
                onPress: () => input.moveTo(0),
            });
        }
        if (input.index < input.count - 2) {
            actions.push({
                id: 'move-last',
                title: t('sessionBoard.companion.actions.moveToLast'),
                icon: 'arrow-circle-down',
                onPress: () => input.moveTo(input.count - 1),
            });
        }
    }
    if (input.openOnBoard) {
        actions.push({
            id: 'open-board',
            title: t('sessionBoard.companion.actions.openOnBoard'),
            icon: 'squares-four',
            onPress: input.openOnBoard,
        });
    }
    actions.push({
        id: 'remove',
        title: t('sessionBoard.companion.actions.removeFromCompanion'),
        icon: 'x',
        onPress: input.remove,
    });
    return actions;
}
