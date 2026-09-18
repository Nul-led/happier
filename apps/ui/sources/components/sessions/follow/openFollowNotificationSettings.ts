import { Modal } from '@/modal';
import { openRouteWithEstablishedHome } from '@/sync/domains/server/selection/openRouteWithEstablishedHome';
import { t } from '@/text';

/** Notifications edits the displayed Home Account; establish that Home before opening it. */
export async function openFollowNotificationSettings(params: Readonly<{
    serverId: string;
    navigate: () => void;
}>): Promise<void> {
    try {
        await openRouteWithEstablishedHome({
            serverId: params.serverId,
            navigate: params.navigate,
        });
    } catch {
        Modal.alert(t('common.error'), t('errors.unknownError'));
    }
}
