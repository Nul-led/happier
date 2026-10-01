import type { HomeConnectionSummary } from '@/components/navigation/connectionStatus/resolveHomeConnectionSummary';
import type { ServerSelectionScope } from '@/sync/domains/server/selection/serverSelectionScope';

/** The one action a Home row offers beside its name, chosen by the Home's real connection state. */
export type HomeRowPrimaryAction = 'switch' | 'signIn' | 'retry';

/**
 * The rarer operations in a Home row's `⋯` menu. `switch` uses this device's routine scope;
 * `switch-tab` switches only this window; `switch-device` makes the Home this device's default.
 */
export type HomeRowMenuAction = 'switch' | 'switch-tab' | 'switch-device' | 'rename' | 'remove';

export function resolveHomeRowActions(params: Readonly<{
    isCurrent: boolean;
    isDeviceDefault: boolean;
    /** The Home has no name of its own (`resolveHomeDisplayName(profile) === null`). */
    isUnnamed: boolean;
    isWeb: boolean;
    routineScope: ServerSelectionScope;
    summaryKind: HomeConnectionSummary['kind'];
}>): Readonly<{ primary: HomeRowPrimaryAction | null; menu: readonly HomeRowMenuAction[] }> {
    // The current Home's state action is the page's attention banner, not a row button.
    const primary: HomeRowPrimaryAction | null = params.isCurrent
        ? null
        : params.summaryKind === 'sign_in'
            ? 'signIn'
            : params.summaryKind === 'unavailable'
                ? 'retry'
                : 'switch';

    const menu: HomeRowMenuAction[] = [];
    // A Home known only by its address is invited to be named first ("Name this Home"); the row keeps
    // its one inline action, so naming never squeezes the Home's name.
    if (params.isUnnamed) menu.push('rename');
    if (!params.isCurrent && primary !== 'switch') menu.push('switch');
    // Where switching already moves the whole device, switching only this window is the extra choice.
    if (!params.isCurrent && params.isWeb && params.routineScope !== 'tab') menu.push('switch-tab');
    // Where switching moves only this tab, making a Home the device default is the extra choice.
    if (params.routineScope === 'tab' && !params.isDeviceDefault) menu.push('switch-device');
    if (!params.isUnnamed) menu.push('rename');
    menu.push('remove');
    return { primary, menu };
}

/** What the page asks of the person about the Home this device uses, if anything. */
export type CurrentHomeAttention = 'signIn' | 'retry' | 'unavailable';

export function resolveCurrentHomeAttention(
    summary: Pick<HomeConnectionSummary, 'kind' | 'action'>,
): CurrentHomeAttention | null {
    if (summary.kind === 'sign_in') return 'signIn';
    if (summary.kind !== 'unavailable') return null;
    return summary.action === 'retry' ? 'retry' : 'unavailable';
}
