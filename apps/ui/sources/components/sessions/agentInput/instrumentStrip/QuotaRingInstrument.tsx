import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SessionUsagePopoverContent } from '@/components/navigation/shell/sidebarFooter/SessionUsagePopoverContent';
import { USAGE_POPOVER_WIDTH_PX } from '@/components/navigation/shell/sidebarFooter/SidebarUsagePopoverContent';
import { TokenUsageRing, type TokenUsageTone } from '@/components/sessions/usage';
import { useHoverPreviewPopover } from '@/components/ui/popover/useHoverPreviewPopover';
import { Text } from '@/components/ui/text/Text';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import type { Metadata } from '@happier-dev/session-core/state';
import { t } from '@/text';

import { AgentInputContentPopover } from '../components/AgentInputContentPopover';
import { motionTokens } from '@/components/ui/motion/motionTokens';

/**
 * Plan/quota usage instrument: the ring is the session's tightest limit (the canonical System-B quota
 * view model). Resting on it previews and a press pins the one Usage popover (lab `csvc` U3), scoped
 * to the account this session signs in with, with "All accounts" to widen it.
 */

export type QuotaRingInstrumentProps = Readonly<{
    viewModel: ConnectedServiceQuotaGaugeViewModel;
    /** The session's metadata and agent: the popover reads which account the session signs in with. */
    metadata?: Metadata | null;
    agentId?: string | null;
    /** The session's own usage-reset action, for a session that signs in on its own. */
    onRecoveryCreditPress?: () => void;
    recoveryCreditPending?: boolean;
    /** Show the provider caption under the ring (≥360px available width). */
    showProviderGlyph: boolean;
    testID?: string;
}>;

function mapQuotaToneToTokenTone(tone: ConnectedServiceQuotaGaugeViewModel['tone']): TokenUsageTone {
    if (tone === 'critical') return 'critical';
    if (tone === 'warning') return 'warning';
    return 'neutral';
}

export const QuotaRingInstrument = React.memo(function QuotaRingInstrument(props: QuotaRingInstrumentProps) {
    const styles = quotaStyles;
    const anchorRef = React.useRef(null);
    // Resting the pointer on the ring previews the popover (web); a press pins it (the shared hover owner).
    const { mode, toggle, close, hoverProps } = useHoverPreviewPopover({ enabled: Platform.OS === 'web' });

    const { viewModel } = props;
    const accessibilityLabel = t('agentInput.providerUsage.accessibilityLabel', {
        value: viewModel.badgeLabel,
    });
    const providerCaption = viewModel.scopePrefix ?? viewModel.providerDisplayName;

    return (
        <>
            <View ref={anchorRef} style={styles.trigger} {...hoverProps}>
                <Pressable
                    testID={props.testID ?? 'session-instrument-quota-ring'}
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    onPress={() => toggle()}
                    hitSlop={12}
                    style={({ pressed }) => (pressed ? styles.triggerPressed : null)}
                >
                    <TokenUsageRing
                        used={viewModel.usedPct}
                        limit={100}
                        label={accessibilityLabel}
                        value={viewModel.ringValueLabel}
                        tone={mapQuotaToneToTokenTone(viewModel.tone)}
                        size={16}
                        strokeWidth={2}
                        ringTestID="session-instrument-quota-ring-arc"
                        valueTestID="session-instrument-quota-ring-value"
                    />
                </Pressable>
                {props.showProviderGlyph && providerCaption ? (
                    <Text style={styles.providerCaption} numberOfLines={1}>
                        {providerCaption}
                    </Text>
                ) : null}
            </View>

            <AgentInputContentPopover
                open={mode !== 'closed'}
                autoFocusOnOpen={mode === 'open'}
                hoverProps={hoverProps}
                anchorRef={anchorRef}
                onRequestClose={close}
                maxWidthCap={USAGE_POPOVER_WIDTH_PX}
                testID="session-instrument-quota-popover"
                content={(
                    <SessionUsagePopoverContent
                        close={close}
                        metadata={props.metadata ?? null}
                        agentId={props.agentId ?? null}
                        viewModel={viewModel}
                        onUseReset={props.onRecoveryCreditPress}
                        resetPending={props.recoveryCreditPending}
                    />
                )}
            />
        </>
    );
});

const quotaStyles = StyleSheet.create((theme) => ({
    trigger: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
    },
    triggerPressed: {
        opacity: motionTokens.press.opacitySubtle,
    },
    providerCaption: {
        fontSize: 8,
        lineHeight: 9,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: theme.colors.text.tertiary,
        maxWidth: 44,
    },
}));
