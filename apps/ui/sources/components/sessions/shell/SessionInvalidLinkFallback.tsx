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
import { getServerProfileById, listServerProfiles, resolveServerProfileScopeId } from '@/sync/domains/server/serverProfiles';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    chooser: { flex: 1, width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
    description: { color: theme.colors.text.secondary, marginVertical: 12 },
    back: { marginVertical: 12 },
}));

function SessionHomeChooser(props: Readonly<{
    sessionId: string;
    candidateServerIds: readonly string[];
    descriptionKey: 'session.whichHomeDescription' | 'session.whichHomeUnknownDescription';
}>) {
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
            <Text style={styles.description}>{t(props.descriptionKey)}</Text>
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

function UnknownSessionHomeChooser(props: Readonly<{ sessionId: string }>) {
    const profilesGeneration = useServerProfilesGeneration();
    const savedServerIds = React.useMemo(() => [...new Set(
        listServerProfiles().map((profile) => resolveServerProfileScopeId(profile)).filter(Boolean),
    )], [profilesGeneration]);
    if (savedServerIds.length === 0) return <SessionInvalidLinkMessage />;
    return <SessionHomeChooser sessionId={props.sessionId} candidateServerIds={savedServerIds} descriptionKey="session.whichHomeUnknownDescription" />;
}

function SessionInvalidLinkMessage() {
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

/**
 * A bare Session link resolves only when its origin names the Home or exactly one
 * known Session address matches (Lane 07.1). Several known candidates ask which of
 * them; a link no Home is known to hold (`homeChoice: 'unknown'`) is never answered
 * by the focused Home — the person chooses which saved Home to open it on, with no
 * preselection, and that choice opens the exact qualified route.
 */
export function SessionInvalidLinkFallback(props: Readonly<{
    sessionId?: string;
    candidateServerIds?: readonly string[];
    homeChoice?: 'unknown';
}> = {}) {
    if (props.sessionId && props.candidateServerIds && props.candidateServerIds.length > 1) {
        return <SessionHomeChooser sessionId={props.sessionId} candidateServerIds={props.candidateServerIds} descriptionKey="session.whichHomeDescription" />;
    }
    if (props.sessionId && props.homeChoice === 'unknown') {
        return <UnknownSessionHomeChooser sessionId={props.sessionId} />;
    }
    return <SessionInvalidLinkMessage />;
}
