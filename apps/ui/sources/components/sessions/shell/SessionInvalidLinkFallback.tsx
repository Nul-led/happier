import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text/Text';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { SelectionList } from '@/components/ui/selectionList/SelectionList';
import type { SelectionListStep } from '@/components/ui/selectionList/_types';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    chooser: { flex: 1, width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
    description: { color: theme.colors.text.secondary, marginVertical: 12 },
    back: { marginVertical: 12 },
}));

function SessionHomeChooser(props: Readonly<{ sessionId: string; candidateServerIds: readonly string[] }>) {
    const navigateToSession = useNavigateToSession();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const maxWidthStyle = useLayoutMaxWidthStyle();
    const profilesGeneration = useServerProfilesGeneration();
    const step = React.useMemo<SelectionListStep>(() => ({
        id: 'homes',
        title: t('session.whichHomeTitle'),
        sections: [{
            kind: 'static',
            id: 'homes',
            options: props.candidateServerIds.map((serverId) => {
                const profile = getServerProfileById(serverId);
                return {
                    id: serverId,
                    label: profile?.name || serverId,
                    subtitle: profile?.serverUrl || serverId,
                };
            }),
        }],
    }), [props.candidateServerIds, profilesGeneration]);
    const backToSessions = React.useCallback(() => router.replace('/'), [router]);
    return (
        <View testID="session-home-chooser" style={[styles.chooser, maxWidthStyle, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Text style={styles.description}>{t('session.whichHomeDescription')}</Text>
            <SelectionList
                rootStep={step}
                selectedOptionId={null}
                listAccessibilityLabel={t('session.whichHomeTitle')}
                fillAvailableSpace
                onSelect={(serverId) => {
                    if (props.candidateServerIds.includes(serverId)) {
                        void navigateToSession(props.sessionId, { serverId });
                    }
                }}
                onRequestClose={backToSessions}
                testID="session-home-chooser.list"
            />
            <RoundButton title={t('common.back')} display="inverted" size="normal" onPress={backToSessions} testID="session-home-chooser.back" style={styles.back} />
        </View>
    );
}

export function SessionInvalidLinkFallback(props: Readonly<{ sessionId?: string; candidateServerIds?: readonly string[] }> = {}) {
    if (props.sessionId && props.candidateServerIds && props.candidateServerIds.length > 1) {
        return <SessionHomeChooser sessionId={props.sessionId} candidateServerIds={props.candidateServerIds} />;
    }
    return (
        <View testID="session-invalid-link" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
            <Text style={{ textAlign: 'center', marginBottom: 8 }}>
                {t('session.invalidLinkTitle')}
            </Text>
            <Text style={{ textAlign: 'center' }}>
                {t('session.invalidLinkDescription')}
            </Text>
        </View>
    );
}
