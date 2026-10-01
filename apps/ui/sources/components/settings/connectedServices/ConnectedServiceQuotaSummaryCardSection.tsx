import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { CardGrid, CardGridColumn, CardSection, MetricCard, PanelCard } from '@/components/ui/cards';
import { ChartTooltip } from '@/components/ui/charts/ChartTooltip';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { t } from '@/text';

import type { ConnectedServiceQuotaSummaryCard } from './buildConnectedServiceQuotaSummaryCards';
import { resolveQuotaToneColor } from '@/sync/domains/connectedServices/resolveQuotaToneColor';
import { UsageMeterRow, UsageMeterStack } from './usage/UsageMeterRow';

type ConnectedServiceQuotaSummaryCardSectionProps = Readonly<{
    title: string;
    cards: ReadonlyArray<ConnectedServiceQuotaSummaryCard>;
    isRefreshing?: boolean;
    showWhenEmpty?: boolean;
    testID?: string;
}>;

/**
 * The usage dashboard's connected-account quotas: one card per account with its windows drawn by
 * the one quota row (`UsageMeterRow`, filled with what is left). A section with no card yet says so
 * through the shared state card, loading while the quotas are read.
 */
export const ConnectedServiceQuotaSummaryCardSection = React.memo(function ConnectedServiceQuotaSummaryCardSection(
    props: ConnectedServiceQuotaSummaryCardSectionProps,
) {
    const { theme } = useUnistyles();

    if (props.cards.length === 0 && !props.isRefreshing && !props.showWhenEmpty) {
        return null;
    }

    const now = Date.now();
    return (
        <CardSection title={props.title} testID={props.testID}>
            {props.cards.length === 0 ? (
                <PanelCard padding="md">
                    <SurfaceStateCard
                        testID={props.isRefreshing ? 'usage-connected-services-quotas-loading' : 'usage-connected-services-quotas-empty'}
                        size="line"
                        kind={props.isRefreshing ? 'loading' : 'empty'}
                        title={props.isRefreshing ? t('common.loading') : t('usage.noData.title')}
                    />
                </PanelCard>
            ) : (
                <CardGrid columns={3} columnGap={12} rowGap={12}>
                    {props.cards.map((card) => (
                        <CardGridColumn key={card.key}>
                            <MetricCard
                                testID={`connected-service-quota-summary-${card.key}`}
                                label={card.title}
                                value={card.value}
                                subtitle={card.subtitle}
                                valueTone="compact"
                                visual={(
                                    <UsageMeterStack>
                                        {card.meters.map((meter) => (
                                            <ChartTooltip
                                                key={meter.key}
                                                triggerTestID={`connected-service-quota-meter-trigger-${card.key}-${meter.key}`}
                                                title={meter.label}
                                                subtitle={card.title}
                                                value={meter.valueText}
                                                accentColor={resolveQuotaToneColor(theme, meter.tone)}
                                            >
                                                <View style={styles.meter}>
                                                    <UsageMeterRow
                                                        testID={`connected-service-quota-meter-${card.key}-${meter.key}`}
                                                        label={meter.label}
                                                        remainingPct={meter.remainingPct}
                                                        resetsAt={meter.resetsAt}
                                                        tone={meter.tone}
                                                        now={now}
                                                    />
                                                </View>
                                            </ChartTooltip>
                                        ))}
                                    </UsageMeterStack>
                                )}
                            />
                        </CardGridColumn>
                    ))}
                </CardGrid>
            )}
        </CardSection>
    );
});

const styles = StyleSheet.create(() => ({
    meter: {
        width: '100%',
    },
}));
