import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { SystemTaskRunState } from '@/components/systemTasks/types';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import type { PersonalHomeBootstrapSnapshot } from '../bootstrap/personalHomeBootstrapTypes';
import { PersonalHomeExistingRuntimeDecision } from './PersonalHomeExistingRuntimeDecision';
import { PersonalHomeSetupFailure } from './PersonalHomeSetupFailure';
import { PersonalHomeDiagnosticDetails } from './PersonalHomeDiagnosticDetails';

const styles = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.background.canvas },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 32, paddingVertical: 36 },
    header: { gap: 12, marginBottom: 30 },
    mark: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.button.primary.background },
    title: { ...Typography.default('semiBold'), color: theme.colors.text.primary, fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
    status: { ...Typography.default(), color: theme.colors.text.secondary, fontSize: 15, lineHeight: 22 },
    activity: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    detailsButton: { alignSelf: 'flex-start', minHeight: 44, marginTop: 20, paddingHorizontal: 4, justifyContent: 'center' },
    detailsText: { ...Typography.default('semiBold'), color: theme.colors.text.secondary, fontSize: 14 },
    details: { marginTop: 8 },
}));

function phaseCopy(snapshot: PersonalHomeBootstrapSnapshot): string {
    switch (snapshot.phase) {
        case 'checking': return t('common.loading');
        case 'ensuring-home': return t('personalHome.bootstrap.ensuringHomeStatus');
        case 'preparing-computer': return t('personalHome.bootstrap.preparingComputerStatus');
        case 'blocked': return t('personalHome.bootstrap.blockedStatus');
        case 'ready': return t('personalHome.bootstrap.readyStatus');
    }
}

type FocusableAction = React.ElementRef<typeof Pressable> & Readonly<{ focus?: () => void }>;

function focusAction(target: React.ElementRef<typeof Pressable> | null): void {
    const focus = (target as FocusableAction | null)?.focus;
    if (typeof focus === 'function') {
        try {
            focus.call(target);
        } catch {
            // Some native/test hosts expose a ref without a usable focus handle.
        }
    }
}

export const PersonalHomeSetupSurface = React.memo(function PersonalHomeSetupSurface(props: Readonly<{
    snapshot: PersonalHomeBootstrapSnapshot;
    activeTask?: SystemTaskRunState | null;
    onRetry?: () => void;
    onOpenDetails?: () => void;
    onUseExisting?: () => void;
    onUseAnotherHome?: () => void;
}>) {
    const { theme } = useUnistyles();
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const retryRef = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const detailsRef = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const useExistingRef = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const focusedRecoveryStateRef = React.useRef<string | null>(null);
    const hasFailure = props.snapshot.phase === 'blocked';
    const showExistingDecision = props.snapshot.action === 'choose-existing-runtime';
    const showFailure = hasFailure && (!showExistingDecision || props.snapshot.detail?.retryable === true);
    const showActivity = !hasFailure && props.snapshot.phase !== 'ready';
    const hasLocalDetails = props.activeTask != null || props.snapshot.detail != null;
    const showDetails = detailsOpen && hasLocalDetails;
    const toggleDetails = React.useCallback(() => setDetailsOpen((value) => !value), []);
    const failureDetailsAction = props.onOpenDetails ?? (hasLocalDetails ? toggleDetails : undefined);
    const recoveryFocusState = showExistingDecision && props.onUseExisting && props.onUseAnotherHome
        ? 'existing-runtime'
        : hasFailure && props.snapshot.action === 'retry' && props.onRetry
            ? 'retry'
            : hasFailure && failureDetailsAction
                ? 'details'
                : null;

    React.useEffect(() => {
        if (recoveryFocusState === null) {
            focusedRecoveryStateRef.current = null;
            return;
        }
        if (focusedRecoveryStateRef.current === recoveryFocusState) return;
        focusedRecoveryStateRef.current = recoveryFocusState;
        if (recoveryFocusState === 'existing-runtime') {
            focusAction(useExistingRef.current);
        } else if (recoveryFocusState === 'retry') {
            focusAction(retryRef.current);
        } else {
            focusAction(detailsRef.current);
        }
    }, [recoveryFocusState]);

    return (
        <View style={styles.root} testID="personal-home-setup-surface">
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                contentInsetAdjustmentBehavior="automatic"
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.header}>
                    <View style={styles.mark} accessible={false} accessibilityElementsHidden>
                        <Icon name="house" size={ICON_SIZE.lg} color={theme.colors.button.primary.tint} />
                    </View>
                    <Text style={styles.title} accessibilityRole="header">
                        {t('personalHome.bootstrap.title')}
                    </Text>
                    <Text testID="personal-home-bootstrap-phase" accessibilityLiveRegion="polite" style={styles.status}>{phaseCopy(props.snapshot)}</Text>
                </View>

                {showActivity ? (
                    <View style={styles.activity} testID="personal-home-bootstrap-activity" accessible={false}>
                        <ActivitySpinner
                            accessible={false}
                            size="small"
                            color={theme.colors.button.primary.background}
                        />
                    </View>
                ) : null}

                {showExistingDecision && props.onUseExisting && props.onUseAnotherHome ? (
                    <PersonalHomeExistingRuntimeDecision
                        primaryActionRef={useExistingRef}
                        onUseExisting={props.onUseExisting}
                        onUseAnotherHome={props.onUseAnotherHome}
                        details={hasLocalDetails ? (
                            <>
                                <Pressable
                                    ref={detailsRef}
                                    testID="personal-home-bootstrap-details-toggle"
                                    accessibilityRole="button"
                                    accessibilityLabel={t('common.details')}
                                    accessibilityState={{ expanded: detailsOpen }}
                                    onPress={toggleDetails}
                                    style={styles.detailsButton}
                                >
                                    <Text style={styles.detailsText}>{detailsOpen ? t('common.collapse') : t('common.details')}</Text>
                                </Pressable>
                                {showDetails ? (
                                    <View style={styles.details} testID="personal-home-bootstrap-details-panel">
                                        <PersonalHomeDiagnosticDetails detail={props.snapshot.detail} activeTask={props.activeTask} />
                                    </View>
                                ) : null}
                            </>
                        ) : undefined}
                    />
                ) : null}

                {showFailure ? (
                    <PersonalHomeSetupFailure
                        retryRef={retryRef}
                        detailsRef={detailsRef}
                        onRetry={props.snapshot.action === 'retry' ? props.onRetry : undefined}
                        onOpenDetails={failureDetailsAction}
                    />
                ) : null}

                {hasLocalDetails && !hasFailure && !showExistingDecision ? (
                    <Pressable
                        testID="personal-home-bootstrap-details-toggle"
                        accessibilityRole="button"
                        accessibilityLabel={t('common.details')}
                        accessibilityState={{ expanded: detailsOpen }}
                        onPress={toggleDetails}
                        style={styles.detailsButton}
                    >
                        <Text style={styles.detailsText}>{detailsOpen ? t('common.collapse') : t('common.details')}</Text>
                    </Pressable>
                ) : null}
                {showDetails ? (
                    <View style={styles.details} testID="personal-home-bootstrap-details-panel">
                        <PersonalHomeDiagnosticDetails detail={props.snapshot.detail} activeTask={props.activeTask} />
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
});
