import type { AccountSettings, WorkflowRunUpdateKindV1 } from '@happier-dev/protocol';

import { getActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import type { WorkflowCoordinatorResult } from '@/daemon/workflows/coordinator';
import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
import { logger } from '@/ui/logger';
import {
  dispatchActivityNotificationAsync,
} from './dispatchActivityNotification';
import type { ExpoPushActivityNotificationSender } from './sendExpoPushActivityNotification';

type SettingsSnapshot = Readonly<{
  settings: AccountSettings | null | undefined;
  settingsSecretsReadKeys?: ReadonlyArray<Uint8Array | null | undefined>;
}>;

type CommittedWorkflowTransition = Readonly<{
  run: Readonly<{ id: string }>;
  result: WorkflowCoordinatorResult;
}>;

function updateKindForResult(
  result: WorkflowCoordinatorResult,
): WorkflowRunUpdateKindV1 | null {
  if (result.state === 'succeeded') {
    return result.completedWithFailures === true
      ? 'completed_with_failures'
      : 'completed';
  }
  if (result.state === 'cancelled') return null;
  return result.state;
}

/**
 * Adapts the coordinator's post-CAS hook to the existing Account Activity
 * dispatcher. Lifecycle remains coordinator-owned. Internal/provider failure
 * detail is deliberately not projected; only the closed update kind leaves
 * the daemon until an explicitly safe reason vocabulary has an owner.
 */
export function createWorkflowRunCommittedNotificationHandler(params: Readonly<{
  getSettingsSnapshot?: () => SettingsSnapshot | null;
  expoPushSender?: ExpoPushActivityNotificationSender | null;
  dispatch?: typeof dispatchActivityNotificationAsync;
}> = {}): (transition: CommittedWorkflowTransition) => Promise<void> {
  const getSettingsSnapshot = params.getSettingsSnapshot ?? getActiveAccountSettingsSnapshot;
  const dispatch = params.dispatch ?? dispatchActivityNotificationAsync;
  return async ({ run, result }) => {
    const updateKind = updateKindForResult(result);
    if (!updateKind) return;
    try {
      const snapshot = getSettingsSnapshot();
      await dispatch({
        settings: snapshot?.settings,
        ...(snapshot?.settingsSecretsReadKeys
          ? { settingsSecretsReadKeys: snapshot.settingsSecretsReadKeys }
          : {}),
        ...(params.expoPushSender ? { expoPushSender: params.expoPushSender } : {}),
        event: {
          topic: 'workflow_run_update',
          runId: run.id,
          updateKind,
        },
      });
    } catch (error) {
      logger.debug(
        '[workflowRunNotifications] Failed to dispatch committed Run update',
        serializeAxiosErrorForLog(error),
      );
    }
  };
}
