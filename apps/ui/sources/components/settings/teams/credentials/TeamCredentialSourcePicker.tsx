import * as React from 'react';
import { Item } from '@/components/ui/lists/Item';
import type { TeamCredentialSourceCandidatePresentationV1 } from '@/hooks/teams/composeTeamCredentialProviderSourceOffer';
import {
    SelectionList,
    resolvePopoverSelectionListHeightBehavior,
    type SelectionListSectionDescriptor,
    type SelectionListStep,
} from '@/components/ui/selectionList';
import { Modal } from '@/modal';
import { t } from '@/text';

import { sourceKindLabel } from './teamCredentialPresentation';

/**
 * Choosing which of your own sources to offer a Team.
 *
 * It is one `SelectionList` over the Home's candidate answer, not a second
 * source model: search, virtualization, keyboard movement and the mobile sheet
 * all belong to that owner, and every fact on a row — the pinned lifetime, the
 * Pool's enabled member count, whether this Team already holds this exact
 * source — arrives in the same answer, so opening the picker costs no request
 * per row.
 *
 * Rows carry no credential value and no "a secret is present" claim: what a
 * source *is* is the whole of what this decision needs.
 */
const PICKER_MAX_HEIGHT = 520;

function PickerContent(props: Readonly<{
    rootStep: SelectionListStep;
    selectedOptionId: string | null;
    accessibilityLabel: string;
    onSelect: (optionId: string) => void;
    onClose: () => void;
}>) {
    return (
        <SelectionList
            testID="team-credential-source-picker"
            rootStep={props.rootStep}
            selectedOptionId={props.selectedOptionId}
            listAccessibilityLabel={props.accessibilityLabel}
            maxHeight={PICKER_MAX_HEIGHT}
            heightBehavior={resolvePopoverSelectionListHeightBehavior()}
            keyboardHintsEnabled
            onRequestClose={props.onClose}
            onSelect={(optionId) => {
                props.onClose();
                props.onSelect(optionId);
            }}
        />
    );
}

/**
 * How one candidate reads, and whether it can still be offered.
 *
 * A source this Team already holds stays visible and unselectable rather than
 * disappearing: "you already shared this" is the answer the person is looking
 * for, and removing the row would leave them hunting for a source that is right
 * in front of them.
 */
function candidateSubtitle(row: TeamCredentialSourceCandidatePresentationV1): string {
    const candidate = row.candidate;
    return [
        sourceKindLabel(candidate.source),
        row.providerSourceOffer?.machineDisplayName ?? null,
        candidate.memberCount === null
            ? null
            : t('teams.credentials.create.poolAccounts', { count: candidate.memberCount }),
        candidate.offeredByResourceId === null ? null : t('teams.credentials.create.alreadyShared'),
    ].filter((part): part is string => part !== null).join(' · ');
}

function candidateSelectable(row: TeamCredentialSourceCandidatePresentationV1): boolean {
    return row.candidate.offeredByResourceId === null;
}

export const TeamCredentialSourcePicker = React.memo(function TeamCredentialSourcePicker(props: Readonly<{
    candidates: readonly TeamCredentialSourceCandidatePresentationV1[];
    selected: TeamCredentialSourceCandidatePresentationV1 | null;
    disabled: boolean;
    /** Truthful state for a chooser that cannot offer anything right now. */
    unavailableReason: string | null;
    onSelect: (candidate: TeamCredentialSourceCandidatePresentationV1) => void;
}>) {
    const { candidates, selected, disabled, unavailableReason, onSelect } = props;
    const modalIdRef = React.useRef<string | null>(null);

    const rootStep = React.useMemo<SelectionListStep>(() => {
        const sections: SelectionListSectionDescriptor[] = [{
            kind: 'static',
            id: 'sources',
            // SelectionList owns search and virtualizes past its own threshold;
            // this chooser keeps no second limit of its own.
            options: candidates.map((row) => ({
                id: row.selectionId,
                testID: `team-credential-source:${row.selectionId}`,
                label: row.candidate.label,
                subtitle: candidateSubtitle(row),
                accessibilityLabel: [row.candidate.label, candidateSubtitle(row)].join(', '),
                disabled: !candidateSelectable(row),
            })),
        }];
        return {
            id: 'team-credential-sources',
            inputPlaceholder: t('modelPickerOverlay.searchPlaceholder'),
            emptyStateLabel: t('teams.credentials.create.sourceEmpty'),
            sections,
        };
    }, [candidates]);

    const close = React.useCallback(() => {
        if (!modalIdRef.current) return;
        Modal.hide(modalIdRef.current);
        modalIdRef.current = null;
    }, []);

    const open = React.useCallback(() => {
        if (disabled) return;
        close();
        modalIdRef.current = Modal.show({
            component: PickerContent,
            props: {
                rootStep,
                selectedOptionId: selected?.selectionId ?? null,
                accessibilityLabel: t('teams.credentials.detail.sourceLabel'),
                onSelect: (optionId: string) => {
                    const candidate = candidates.find((entry) => entry.selectionId === optionId);
                    if (candidate && candidateSelectable(candidate)) onSelect(candidate);
                },
            },
            chrome: {
                kind: 'card',
                title: t('teams.credentials.detail.sourceLabel'),
                testID: 'team-credential-source-picker:modal',
                scrollHost: 'body',
                bodyScroll: 'none',
            },
            closeOnBackdrop: true,
        });
    }, [candidates, close, disabled, onSelect, rootStep, selected]);

    // The create route can stay mounted behind another Settings destination
    // while this picker remains portaled; unmount closes it with the screen.
    React.useEffect(() => close, [close]);

    return (
        <Item
            testID="team-credential-create-source"
            title={t('teams.credentials.detail.sourceLabel')}
            detail={selected?.candidate.label ?? unavailableReason ?? t('teams.credentials.create.sourceChoose')}
            subtitle={selected === null ? undefined : candidateSubtitle(selected)}
            accessibilityLabel={[
                t('teams.credentials.detail.sourceLabel'),
                selected?.candidate.label ?? unavailableReason ?? t('teams.credentials.create.sourceChoose'),
            ].join(', ')}
            disabled={disabled || unavailableReason !== null}
            onPress={open}
        />
    );
});
