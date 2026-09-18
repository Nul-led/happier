import * as React from 'react';

import {
    SelectionList,
    resolvePopoverSelectionListHeightBehavior,
    type SelectionListStep,
} from '@/components/ui/selectionList';
import type { FocusReturnRef } from '@/keyboard/focusReturn';
import { Modal } from '@/modal';
import { t } from '@/text';

import type {
    SessionBoardViewRemovalChoiceRequest,
    SessionBoardViewRemovalDisposition,
} from './useSessionBoardController';

const VIEW_REMOVAL_PICKER_MAX_HEIGHT = 420;

type SessionBoardViewRemovalDispositionPickerProps = Readonly<{
    request: SessionBoardViewRemovalChoiceRequest;
    onChoose: (choice: SessionBoardViewRemovalDisposition) => void;
    onClose: () => void;
}>;

export function SessionBoardViewRemovalDispositionPicker(
    props: SessionBoardViewRemovalDispositionPickerProps,
): React.ReactElement {
    const choices = React.useMemo(() => new Map<string, SessionBoardViewRemovalDisposition>([
        ...props.request.eligibleDestinations.map((destination) => [
            `move:${destination.viewId}`,
            { kind: 'move' as const, viewId: destination.viewId },
        ] as const),
        ['unpin', { kind: 'unpin' as const }],
    ]), [props.request.eligibleDestinations]);
    const rootStep = React.useMemo<SelectionListStep>(() => ({
        id: 'session-board-view-removal',
        sections: [{
            kind: 'static',
            id: 'dispositions',
            options: [
                ...props.request.eligibleDestinations.map((destination) => ({
                    id: `move:${destination.viewId}`,
                    label: destination.title,
                    subtitle: t('sessionBoard.views.remove.moveMessage', { title: destination.title }),
                    testID: `session-board-view-removal-move-${destination.viewId}`,
                })),
                {
                    id: 'unpin',
                    label: t('sessionBoard.item.actions.unpin'),
                    subtitle: t('sessionBoard.views.remove.unpinMessage'),
                    testID: 'session-board-view-removal-unpin',
                },
            ],
        }],
    }), [props.request.eligibleDestinations]);

    return (
        <SelectionList
            testID="session-board-view-removal-choices"
            rootStep={rootStep}
            selectedOptionId={null}
            listAccessibilityLabel={t('sessionBoard.views.remove.title', { title: props.request.source.title })}
            maxHeight={VIEW_REMOVAL_PICKER_MAX_HEIGHT}
            heightBehavior={resolvePopoverSelectionListHeightBehavior()}
            keyboardHintsEnabled
            onRequestClose={props.onClose}
            onSelect={(optionId) => {
                const choice = choices.get(optionId);
                if (!choice) return;
                props.onClose();
                props.onChoose(choice);
            }}
        />
    );
}

/**
 * Presents the one explicit disposition choice required before deleting a
 * populated Board view. The promise is cancellation-safe even if the modal
 * host disappears during a route or responsive transition.
 */
export function showSessionBoardViewRemovalDisposition(
    request: SessionBoardViewRemovalChoiceRequest,
    focusReturnRef?: FocusReturnRef,
): Promise<SessionBoardViewRemovalDisposition | null> {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (choice: SessionBoardViewRemovalDisposition | null) => {
            if (settled) return;
            settled = true;
            resolve(choice);
        };
        const modalId = Modal.show({
            component: SessionBoardViewRemovalDispositionPicker,
            props: {
                request,
                onChoose: settle,
            },
            accessibilityLabel: t('sessionBoard.views.remove.title', { title: request.source.title }),
            focusReturnRef,
            closeOnBackdrop: true,
            onRequestClose: () => settle(null),
            onHostUnmount: () => settle(null),
            chrome: {
                kind: 'card',
                title: t('sessionBoard.views.remove.title', { title: request.source.title }),
                testID: 'session-board-view-removal-modal',
                scrollHost: 'body',
                bodyScroll: 'none',
            },
        });
        if (modalId.length === 0) settle(null);
    });
}
