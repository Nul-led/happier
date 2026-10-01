import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { PAGE_LIST_METRICS } from '@/components/ui/lists/pageListMetrics';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

type Benefit = Readonly<{ icon: 'magnifying-glass' | 'key' | 'device-mobile'; title: string; description: string }>;

/** Below this width the three benefits read as a checklist instead of side-by-side columns. */
const BENEFIT_COLUMN_MIN_WIDTH_PX = 160;

/**
 * What the account service is, in one sentence under its mark. The section keeps it in every
 * signed-out and trouble state, so the section never loses its reason to exist.
 */
export const AccountServiceInvitationIntro = React.memo(function AccountServiceInvitationIntro(props: Readonly<{
    serviceMark: React.ReactNode;
}>) {
    return (
        <View style={styles.intro}>
            {/* The service mark centres on the title and description it introduces. */}
            <View style={styles.mark}>{props.serviceMark}</View>
            <View style={styles.introText}>
                <Text style={styles.title}>{t('settingsAccount.accountServiceInviteTitle')}</Text>
                <Text style={styles.body}>{t('settingsAccount.accountServiceInviteBody')}</Text>
            </View>
        </View>
    );
});

/**
 * The service's real capabilities — finding linked Homes, opening them directly, and connecting
 * other devices — as three columns on wide sheets and a checklist on phones.
 */
export const AccountServiceBenefits = React.memo(function AccountServiceBenefits() {
    const { theme } = useUnistyles();
    const [columns, setColumns] = React.useState(true);
    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        setColumns(event.nativeEvent.layout.width >= BENEFIT_COLUMN_MIN_WIDTH_PX * 3);
    }, []);
    const benefits: readonly Benefit[] = [
        { icon: 'magnifying-glass', title: t('settingsAccount.accountServiceBenefitFindHomes'), description: t('settingsAccount.accountServiceBenefitFindHomesDescription') },
        { icon: 'key', title: t('settingsAccount.accountServiceBenefitSignIn'), description: t('settingsAccount.accountServiceBenefitSignInDescription') },
        { icon: 'device-mobile', title: t('settingsAccount.accountServiceBenefitDevices'), description: t('settingsAccount.accountServiceBenefitDevicesDescription') },
    ];
    return (
        <View onLayout={onLayout} style={columns ? styles.benefitColumns : styles.benefitList}>
            {benefits.map((benefit, index) => (
                <View
                    key={benefit.icon}
                    style={[
                        columns ? styles.benefitColumn : styles.benefitListItem,
                        columns && index > 0 ? styles.benefitColumnDivider : null,
                    ]}
                >
                    <View style={styles.benefitHeading}>
                        <Icon name={benefit.icon} size={15} color={theme.colors.text.secondary} />
                        <Text style={styles.benefitTitle}>{benefit.title}</Text>
                    </View>
                    <Text style={[styles.benefitDescription, columns ? null : styles.benefitDescriptionIndented]}>{benefit.description}</Text>
                </View>
            ))}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    intro: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    mark: {
        flexShrink: 0,
    },
    introText: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        ...Typography.default('medium'),
        color: theme.colors.text.primary,
        fontSize: 15,
        lineHeight: 20,
    },
    body: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 3,
    },
    // Columns bleed to the sheet edges so their dividers meet the band's hairlines.
    benefitColumns: {
        flexDirection: 'row',
        marginHorizontal: -PAGE_LIST_METRICS.rowPaddingHorizontalPx,
    },
    benefitColumn: {
        flex: 1,
        minWidth: 0,
        paddingHorizontal: PAGE_LIST_METRICS.rowPaddingHorizontalPx,
    },
    benefitColumnDivider: {
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: theme.colors.border.subtle,
    },
    benefitList: {
        gap: 12,
    },
    benefitListItem: {
        minWidth: 0,
    },
    benefitHeading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    benefitTitle: {
        ...Typography.default('medium'),
        color: theme.colors.text.primary,
        fontSize: 13,
        lineHeight: 18,
    },
    benefitDescription: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
        fontSize: 12.5,
        lineHeight: 17,
        marginTop: 3,
    },
    benefitDescriptionIndented: {
        marginLeft: 22,
    },
}));
