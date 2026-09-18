import * as React from 'react';

import { Modal } from '@/modal';
import { t } from '@/text';
import type { ActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';
import { useUnsavedChangesBeforeRemoveGuard } from '@/utils/navigation/useUnsavedChangesBeforeRemoveGuard';
import { promptUnsavedChangesAlert } from '@/utils/ui/promptUnsavedChangesAlert';

type NavigationDispatcher = Readonly<{ dispatch?: (action: unknown) => void }>;

/** Binds the shared resource draft to Happier's existing settings guard owner. */
export function useTeamCredentialDraftNavigationGuard(input: Readonly<{
    navigation: unknown;
    isDirty: boolean;
    onDiscard: () => void;
    tag: string;
}>) {
    const isDirtyRef = React.useRef(input.isDirty);
    isDirtyRef.current = input.isDirty;
    const ignoreRef = React.useRef(false);
    const requestDecision = React.useCallback(() => promptUnsavedChangesAlert(
        (title, message, buttons) => Modal.alert(title, message, buttons),
        {
            title: t('common.discardChanges'),
            message: t('common.unsavedChangesWarning'),
            discardText: t('common.discard'),
            keepEditingText: t('common.keepEditing'),
        },
    ), []);
    const discard = React.useCallback(() => {
        input.onDiscard();
        isDirtyRef.current = false;
    }, [input.onDiscard]);
    const onContinue = React.useCallback((action: unknown) => {
        (input.navigation as NavigationDispatcher | null)?.dispatch?.(action);
    }, [input.navigation]);
    const guard = React.useMemo<ActiveUnsavedChangesGuard>(() => ({
        isDirtyRef,
        ignoreRef,
        requestDecision,
        onDiscard: discard,
        tag: input.tag,
    }), [discard, input.tag, requestDecision]);

    useUnsavedChangesBeforeRemoveGuard({
        isDirty: input.isDirty,
        isDirtyRef,
        ignoreRef,
        requestDecision,
        onDiscard: discard,
        onContinue,
        tag: input.tag,
    });
    useActiveUnsavedChangesGuard({ navigation: input.navigation, guard, enabled: input.isDirty });

    return React.useCallback(() => {
        ignoreRef.current = true;
        isDirtyRef.current = false;
    }, []);
}
