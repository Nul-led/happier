import * as React from 'react';
import { useGlobalSearchParams, useRouter } from '@/components/appShell/workspace/destinationRoute';

import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';

import {
    API_TOKEN_CREATE_RESUME_CLEARED_PARAMS,
    isApiTokenCreateResumeForActiveAccount,
    readApiTokenCreateResume,
} from '../apiTokenCreateResume';
import { createApiTokenSettingsController, type ApiTokenSettingsController } from '../apiTokenSettingsController';
import { showApiTokenCreateModal } from '../showApiTokenCreateModal';

const ApiTokenSettingsControllerContext = React.createContext<ApiTokenSettingsController | null>(null);

/**
 * One API token controller for the whole collection: the rail, the list page and every token detail
 * read the same list and share one create, edit and revoke lifecycle. It refreshes when the active
 * Account or Home changes and retires with the collection.
 */
export const ApiTokenSettingsScope = React.memo(function ApiTokenSettingsScope(props: Readonly<{
    controller?: ApiTokenSettingsController;
    children: React.ReactNode;
}>) {
    const ownedRef = React.useRef<ApiTokenSettingsController | null>(null);
    if (!props.controller && !ownedRef.current) ownedRef.current = createApiTokenSettingsController();
    const controller = props.controller ?? ownedRef.current!;
    const activeServerAccountScope = useActiveServerAccountScope();

    React.useEffect(() => {
        void controller.refresh();
    }, [activeServerAccountScope?.accountId, activeServerAccountScope?.serverId, controller]);

    React.useInsertionEffect(() => {
        if (props.controller) return undefined;
        return () => controller.retire();
    }, [controller, props.controller]);

    useResumeCreateFromRestore(controller);

    return (
        <ApiTokenSettingsControllerContext.Provider value={controller}>
            {props.children}
        </ApiTokenSettingsControllerContext.Provider>
    );
});

/** The collection's controller. Only screens mounted inside `ApiTokenSettingsScope` call this. */
export function useApiTokenSettingsScopeController(): ApiTokenSettingsController {
    const controller = React.useContext(ApiTokenSettingsControllerContext);
    if (!controller) throw new Error('useApiTokenSettingsScopeController requires ApiTokenSettingsScope');
    return controller;
}

/** The enclosing collection's controller, or null for a page mounted on its own. */
export function useOptionalApiTokenSettingsScopeController(): ApiTokenSettingsController | null {
    return React.useContext(ApiTokenSettingsControllerContext);
}

type RouteParam = string | string[] | undefined;

/**
 * Restoring encryption access returns here with the complete create draft in the URL
 * (`apiTokenCreateResume`). The draft reopens only for the exact Account and Home it was started on;
 * any other arrival, or a draft that does not parse, drops the parameters. An embed's draft is
 * resumed by the embed create page itself.
 */
function useResumeCreateFromRestore(controller: ApiTokenSettingsController): void {
    const router = useRouter();
    const params = useGlobalSearchParams<Record<string, RouteParam>>();
    const activeServerAccountScope = useActiveServerAccountScope();
    const resumedRef = React.useRef(false);
    React.useEffect(() => {
        if (resumedRef.current || params.resumeCreate === undefined) return;
        resumedRef.current = true;
        const resume = readApiTokenCreateResume(params);
        if (resume && isApiTokenCreateResumeForActiveAccount(resume, {
            scope: activeServerAccountScope ?? null,
            server: getActiveServerSnapshot(),
        })) {
            controller.setCreateDraft(resume.draft);
            if (!resume.draft.embedConfig) showApiTokenCreateModal(controller);
        }
        router.setParams(API_TOKEN_CREATE_RESUME_CLEARED_PARAMS);
    }, [activeServerAccountScope, controller, params, router]);
}
