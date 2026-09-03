import * as React from 'react';

import {
    OVERLAY_CAPSULE_BUTTON_GAP,
    OVERLAY_CAPSULE_ROW_HEIGHT,
    OverlayCapsuleButton,
} from '@/components/ui/overlays/OverlayCapsuleButton';
import { t } from '@/text';

/**
 * The close affordance for the floating new-session composer.
 *
 * The sheet this replaces carried a header close button. Dropping the header is what makes the
 * composer read as a bare surface rather than a form — but it also removes the only guaranteed way
 * out, and a backdrop tap is not a sufficient substitute: an overlay whose only dismissal is
 * "tap somewhere that looks like nothing" is both an accessibility gap and a well-known cause of
 * accidental dismissals.
 *
 * The capsule itself is `OverlayCapsuleButton` — the shared owner for a floating control beside a
 * bottom-anchored overlay surface, which the native Search overlay uses for the same pair of
 * controls. This module keeps only the composer's copy and test ids.
 */

/** Separates the capsule row from the composer card without letting their hit areas meet. */
export const NEW_SESSION_CLOSE_BUTTON_GAP = OVERLAY_CAPSULE_BUTTON_GAP;

/**
 * Total vertical space the capsule row takes above the card.
 *
 * Exported because the composer's height budget has to reserve it: the row is drawn outside the card
 * but inside the same bottom-anchored slot, so a budget that ignores it lets a long draft push the
 * row off the top of the screen — taking the only visible dismiss control with it.
 */
export const NEW_SESSION_CLOSE_ROW_HEIGHT = OVERLAY_CAPSULE_ROW_HEIGHT;

export const NewSessionComposerCloseButton = React.memo(function NewSessionComposerCloseButton(
    props: Readonly<{ onPress: () => void }>,
): React.ReactElement {
    return (
        <OverlayCapsuleButton
            testID="new-session-composer-close"
            accessibilityLabel={t('common.cancel')}
            icon="x"
            onPress={props.onPress}
        />
    );
});

/**
 * Retracts the keyboard without leaving the composer.
 *
 * In this presentation a backdrop tap dismisses the whole screen, so — unlike the sheet it replaces,
 * where tapping the empty sheet area only lowered the keyboard — no gesture retracts the keyboard
 * alone. This capsule restores that, and exists only while the keyboard is up so it never sits there
 * as dead chrome.
 */
export const NewSessionComposerKeyboardDismissButton = React.memo(
    function NewSessionComposerKeyboardDismissButton(
        props: Readonly<{ onPress: () => void }>,
    ): React.ReactElement {
        return (
            <OverlayCapsuleButton
                testID="new-session-composer-dismiss-keyboard"
                accessibilityLabel={t('common.dismissKeyboard')}
                icon="caret-down"
                onPress={props.onPress}
            />
        );
    },
);
