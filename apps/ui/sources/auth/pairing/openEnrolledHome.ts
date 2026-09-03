import { Modal } from '@/modal';
import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { t } from '@/text';
import { Platform } from 'react-native';
import { resolveRoutineServerSelectionScope } from '@/sync/domains/server/selection/serverSelectionScope';
import { isDesktopHost } from '@/utils/platform/desktopHost';

export type OpenEnrolledHomeResult = 'opened' | 'returned_to_shell' | 'cancelled';

/**
 * Opens one exact already-adopted Home. A failed focus switch cannot undo the
 * committed credential/profile, so keep that exact profile available for retry
 * and let the user return to the shell without claiming that focus changed.
 */
export async function openEnrolledHomeOrReturnToShell(params: Readonly<{
    profileId: string;
    targetLabel: string;
    isCurrent: () => boolean;
}>): Promise<OpenEnrolledHomeResult> {
    while (params.isCurrent()) {
        try {
            const switchResult = await setActiveServerAndSwitch({
                serverId: params.profileId,
                scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
            });
            if (!params.isCurrent()) return 'cancelled';
            if (switchResult === 'switched' || switchResult === 'already_active') {
                return 'opened';
            }
        } catch {
            if (!params.isCurrent()) return 'cancelled';
        }

        let retry = false;
        await Modal.alertAsync(
            params.targetLabel,
            t('connect.homeAddedPreservedFocusBody'),
            [
                {
                    text: t('common.open'),
                    onPress: () => {
                        retry = true;
                    },
                },
                { text: t('common.cancel'), style: 'cancel' },
            ],
        );
        if (!params.isCurrent()) return 'cancelled';
        if (!retry) {
            return 'returned_to_shell';
        }
    }
    return 'cancelled';
}
