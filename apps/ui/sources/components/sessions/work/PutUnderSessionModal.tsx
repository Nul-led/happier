import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SelectionList } from '@/components/ui/selectionList/SelectionList';
import type { SelectionListStep } from '@/components/ui/selectionList/_types';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal, type CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { getStorage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { setSessionReportsTo } from '@/sync/ops/relations/setSessionReportsTo';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';

import { describeReportsToRefusal } from './putSessionUnderLead';
import { listPutUnderCandidates } from './putUnderCandidates';

/**
 * "Put under…" (ORC §3.8, R-03): the keyboard and screen-reader equivalent of dragging a Session
 * under a lead. It lists the Sessions on the same Home that can lead this one — never itself or a
 * Session already under it — plus "Top level" when it reports somewhere now, and asks the one
 * `session.reports_to.set` Action with the lead it saw as the expected current lead. The server's
 * fence and compare-and-set decide; a refusal is said in words and nothing else changes.
 */

const TOP_LEVEL_OPTION_ID = '__top_level__';

const stylesheet = StyleSheet.create((theme) => ({
    body: {
        minHeight: 320,
        maxHeight: 520,
    },
    error: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.state.danger.foreground,
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
}));

type PutUnderSessionModalProps = CustomModalInjectedProps & Readonly<{
    sessionId: string;
    serverId: string | null;
}>;

export function PutUnderSessionModal(props: PutUnderSessionModalProps) {
    const styles = stylesheet;
    const { onClose } = props;
    const [error, setError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    // A snapshot taken when the sheet opens: the choice is made against what the person saw.
    const snapshot = React.useMemo(() => {
        const sessions = getStorage().getState().sessions as Readonly<Record<string, Session>>;
        const self = sessions[props.sessionId] ?? null;
        return {
            currentLeadId: self?.reportsTo?.sessionId ?? null,
            candidates: self ? listPutUnderCandidates(sessions, self) : [],
        };
    }, [props.sessionId]);

    const step = React.useMemo<SelectionListStep>(() => ({
        id: 'leads',
        inputPlaceholder: t('sessionWork.putUnder.search'),
        sections: [{
            kind: 'static',
            id: 'leads',
            options: [
                ...(snapshot.currentLeadId ? [{ id: TOP_LEVEL_OPTION_ID, label: t('sessionWork.putUnder.topLevel') }] : []),
                ...snapshot.candidates.map((candidate) => ({
                    id: candidate.id,
                    label: getSessionName(candidate, candidate.serverId ?? null),
                })),
            ],
        }],
    }), [snapshot]);

    const onSelect = React.useCallback((optionId: string) => {
        if (busy) return;
        const leadSessionId = optionId === TOP_LEVEL_OPTION_ID ? null : optionId;
        if (leadSessionId === snapshot.currentLeadId) {
            onClose();
            return;
        }
        setBusy(true);
        setError(null);
        void setSessionReportsTo({
            sessionId: props.sessionId,
            leadSessionId,
            expectedLeadSessionId: snapshot.currentLeadId,
            serverId: props.serverId,
        }).then((result) => {
            if (result.ok) {
                onClose();
                return;
            }
            setBusy(false);
            setError(describeReportsToRefusal(result.errorCode));
        }, () => {
            setBusy(false);
            setError(describeReportsToRefusal(undefined));
        });
    }, [busy, onClose, props.serverId, props.sessionId, snapshot.currentLeadId]);

    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title: t('sessionWork.putUnder.title'),
        testID: 'session-put-under-modal',
        dimensions: { width: 420, maxHeightRatio: 0.8, size: 'dialog' as const },
    }), []);
    useModalCardChrome(props.setChrome, chrome);

    return (
        <View style={styles.body}>
            {error ? <Text testID="session-put-under-error" style={styles.error}>{error}</Text> : null}
            <SelectionList
                rootStep={step}
                selectedOptionId={snapshot.currentLeadId}
                listAccessibilityLabel={t('sessionWork.putUnder.title')}
                fillAvailableSpace
                onSelect={onSelect}
                onRequestClose={onClose}
                testID="session-put-under-list"
            />
        </View>
    );
}

export function showPutUnderSessionModal(params: Readonly<{ sessionId: string; serverId: string | null }>): void {
    Modal.show({ component: PutUnderSessionModal, props: params });
}
