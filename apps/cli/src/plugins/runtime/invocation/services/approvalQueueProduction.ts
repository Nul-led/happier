import { readStoredCredentials } from '@/persistence';
import { createCliActionExecutorFromCredentials } from '@/session/actions/createCliActionExecutorFromCredentials';
import type { RuntimeActionSettingsProvider } from '@/settings/actionsSettingsProvider';

import {
    createStablePluginApprovalQueueOwner,
    type StablePluginApprovalQueueOwner,
} from './approvalQueue';

export function createProductionPluginApprovalQueueOwner(params?: Readonly<{
    readCredentials?: typeof readStoredCredentials;
    actionsSettingsProvider?: RuntimeActionSettingsProvider;
    recordDiagnostic?: Parameters<typeof createStablePluginApprovalQueueOwner>[0]['recordDiagnostic'];
}>): StablePluginApprovalQueueOwner {
    const readCredentials = params?.readCredentials ?? readStoredCredentials;
    return createStablePluginApprovalQueueOwner({
        async resolveExecutor() {
            const credentials = await readCredentials().catch(() => null);
            return credentials
                ? createCliActionExecutorFromCredentials({
                    credentials,
                    ...(params?.actionsSettingsProvider
                        ? { actionsSettingsProvider: params.actionsSettingsProvider }
                        : {}),
                })
                : null;
        },
        ...(params?.recordDiagnostic ? { recordDiagnostic: params.recordDiagnostic } : {}),
    });
}
