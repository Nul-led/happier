export const HOME_QR_ENTRY_INTENT_ROUTE_PARAM = 'entryIntent' as const;

export type HomeQrEntryIntent = 'enter_home' | 'add_home';

export const ADD_HOME_RESTORE_PATH = '/restore?entryIntent=add_home' as const;

export function parseHomeQrEntryIntentRouteParam(
    value: string | string[] | undefined,
): HomeQrEntryIntent | null {
    const candidate = Array.isArray(value) ? value[0] : value;
    return candidate === 'enter_home' || candidate === 'add_home' ? candidate : null;
}
