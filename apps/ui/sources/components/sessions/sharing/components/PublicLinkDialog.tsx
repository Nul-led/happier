import React, { memo, useEffect, useState } from 'react';
import { View, Platform, Linking, ScrollView } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';
import type { CustomModalInjectedProps } from '@/modal';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import type { SessionPublicLinkPublication } from '@/sync/domains/social/sessionPublicLinkPublication';
import { HappyError } from '@/utils/errors/errors';
import { QRCode } from '@/components/qr';
import { Text } from '@/components/ui/text/Text';
import { useScrollViewWheelScrollTo } from '@/components/ui/scroll/useScrollViewWheelScrollTo';
import { CopiedPill } from '@/components/ui/copy/CopiedPill';
import { useTemporaryCopyFeedback } from '@/components/ui/copy/useTemporaryCopyFeedback';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import { Icon } from '@/components/ui/icons/Icon';
import { Switch } from '@/components/ui/forms/Switch';
import { buildPublicShareApplicationUrl } from '../publicShareApplicationUrl';


export interface PublicLinkDialogProps {
    publicShare: SessionPublicLinkPublication | null;
    serverUrl?: string | null;
    onCreate: (options: {
        expiresInDays?: number;
        maxUses?: number;
        isConsentRequired: boolean;
    }) => Promise<SessionPublicLinkPublication | void> | SessionPublicLinkPublication | void;
    onDelete: () => Promise<void> | void;
}

export const PublicLinkDialog = memo(function PublicLinkDialog({
    publicShare,
    serverUrl,
    onCreate,
    onDelete,
    onClose: _onClose,
}: PublicLinkDialogProps & CustomModalInjectedProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [isConfiguring, setIsConfiguring] = useState(false);
    const [expiresInDays, setExpiresInDays] = useState<number | undefined>(7);
    const [maxUses, setMaxUses] = useState<number | undefined>(undefined);
    const [isConsentRequired, setIsConsentRequired] = useState(true);
    const copyFeedback = useTemporaryCopyFeedback();

    const scrollRef = React.useRef<ScrollView>(null);
    const wheelScrollHandlers = useScrollViewWheelScrollTo(scrollRef);

    /**
     * Revocation's own request lifecycle.
     *
     * Creating a link runs through the shared pressable pending owner, which
     * refuses a second press while the first request is in flight. The
     * destructive row has no such owner, so the same guarantee lives here: the
     * ref refuses a same-tick second activation before React has committed the
     * disabled row, and the presented-link identity decides whether a settled
     * outcome still belongs to the surface the user is looking at. A second
     * DELETE would otherwise surface its 404 after the first one closed.
     */
    const revokeInFlight = React.useRef(false);
    const [isRevoking, setIsRevoking] = useState(false);
    const presentedLinkId = React.useRef<string | null>(null);
    presentedLinkId.current = publicShare?.id ?? null;
    const isMounted = React.useRef(true);
    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const buildPublicShareUrl = React.useCallback((token: string): string => {
        let applicationBaseUrl: string;
        if (Platform.OS === 'web') {
            applicationBaseUrl =
                typeof window !== 'undefined' && window.location?.origin
                    ? window.location.origin
                    : '';
        } else {
            const configuredWebAppUrl = (process.env.EXPO_PUBLIC_HAPPY_WEBAPP_URL || '').trim();
            applicationBaseUrl = configuredWebAppUrl || 'https://app.happier.dev';
        }
        return buildPublicShareApplicationUrl({ applicationBaseUrl, token, serverUrl });
    }, [serverUrl]);

    useEffect(() => {
        if (!publicShare?.token) {
            setShareUrl(null);
            return;
        }

        const url = buildPublicShareUrl(publicShare.token);
        setShareUrl(url);
    }, [buildPublicShareUrl, publicShare?.token]);

    useEffect(() => {
        if (!shareUrl) return;
        // Ensure the generated QR code is visible even if the user was scrolled
        // to the bottom of the configuration screen when creating the link.
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
    }, [shareUrl]);

    const handleCreate = async () => {
        try {
            await Promise.resolve(onCreate({
                expiresInDays,
                maxUses,
                isConsentRequired,
            }));
            setIsConfiguring(false);
            // When generating/regenerating a link, users often press the button at the bottom
            // of the config screen. Scroll back to top so the resulting QR code is visible.
            requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
        } catch (e) {
            const message =
                e instanceof HappyError ? e.message :
                e instanceof Error ? e.message :
                t('errors.unknownError');
            Modal.alert(t('common.error'), message);
        }
    };

    const handleDelete = async () => {
        if (revokeInFlight.current) return;
        const revokedLinkId = presentedLinkId.current;
        revokeInFlight.current = true;
        setIsRevoking(true);
        // A settled outcome may only speak for the link that is still presented
        // on a still-mounted dialog; anything else closes or alerts over a
        // surface the user has already moved past.
        const settlesThisSurface = () => isMounted.current && presentedLinkId.current === revokedLinkId;
        try {
            await Promise.resolve(onDelete());
            if (settlesThisSurface()) _onClose();
        } catch (e) {
            if (settlesThisSurface()) {
                const message =
                    e instanceof HappyError ? e.message :
                    e instanceof Error ? e.message :
                    t('errors.unknownError');
                Modal.alert(t('common.error'), message);
            }
        } finally {
            revokeInFlight.current = false;
            if (isMounted.current) setIsRevoking(false);
        }
    };

    const handleOpenLink = async () => {
        if (!shareUrl) return;
        try {
            if (Platform.OS === 'web') {
                window.open(shareUrl, '_blank', 'noopener,noreferrer');
                return;
            }
            await Linking.openURL(shareUrl);
        } catch {
            // ignore
        }
    };

    const handleCopyLink = async () => {
        if (!shareUrl) return;
        const copied = await setClipboardStringSafe(shareUrl);
        if (!copied) {
            Modal.alert(t('common.error'), t('textSelection.failedToCopy'));
            return;
        }
        copyFeedback.markCopied('public-link');
    };

    const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString();

    const Radio = ({ selected }: { selected: boolean }) => (
        <View style={[styles.radioOuter, selected ? styles.radioActive : styles.radioInactive]}>
            {selected ? <View style={styles.radioDot} /> : null}
        </View>
    );

    return (
        <View
            style={styles.body}
            {...(Platform.OS === 'web' ? ({ onWheel: wheelScrollHandlers.onWheel } as any) : {})}
        >
            <ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                onScroll={wheelScrollHandlers.onScroll}
                scrollEventThrottle={16}
            >
                        {!publicShare || isConfiguring ? (
                            <>
                                <View style={styles.section}>
                                    <Text style={styles.descriptionText}>
                                        {t('session.sharing.publicLinkDescription')}
                                    </Text>
                                </View>

                                <ItemGroup
                                    title={t('session.sharing.expiresIn')}
                                    accessibilityRole="radiogroup"
                                    accessibilityLabel={t('session.sharing.expiresIn')}
                                >
                                    <Item
                                        testID="public-link-expiry-7"
                                        title={t('session.sharing.days7')}
                                        leftElement={<Radio selected={expiresInDays === 7} />}
                                        selected={expiresInDays === 7}
                                        accessibilityRole="radio"
                                        webRole="radio"
                                        accessibilityChecked={expiresInDays === 7}
                                        onPress={() => setExpiresInDays(7)}
                                        showChevron={false}
                                    />
                                    <Item
                                        testID="public-link-expiry-30"
                                        title={t('session.sharing.days30')}
                                        leftElement={<Radio selected={expiresInDays === 30} />}
                                        selected={expiresInDays === 30}
                                        accessibilityRole="radio"
                                        webRole="radio"
                                        accessibilityChecked={expiresInDays === 30}
                                        onPress={() => setExpiresInDays(30)}
                                        showChevron={false}
                                    />
                                    <Item
                                        testID="public-link-expiry-never"
                                        title={t('session.sharing.never')}
                                        leftElement={<Radio selected={expiresInDays === undefined} />}
                                        selected={expiresInDays === undefined}
                                        accessibilityRole="radio"
                                        webRole="radio"
                                        accessibilityChecked={expiresInDays === undefined}
                                        onPress={() => setExpiresInDays(undefined)}
                                        showChevron={false}
                                        showDivider={false}
                                    />
                                </ItemGroup>

                                <ItemGroup
                                    title={t('session.sharing.maxUsesLabel')}
                                    accessibilityRole="radiogroup"
                                    accessibilityLabel={t('session.sharing.maxUsesLabel')}
                                >
                                    <Item
                                        testID="public-link-max-uses-unlimited"
                                        title={t('session.sharing.unlimited')}
                                        leftElement={<Radio selected={maxUses === undefined} />}
                                        selected={maxUses === undefined}
                                        accessibilityRole="radio"
                                        webRole="radio"
                                        accessibilityChecked={maxUses === undefined}
                                        onPress={() => setMaxUses(undefined)}
                                        showChevron={false}
                                    />
                                    <Item
                                        testID="public-link-max-uses-10"
                                        title={t('session.sharing.uses10')}
                                        leftElement={<Radio selected={maxUses === 10} />}
                                        selected={maxUses === 10}
                                        accessibilityRole="radio"
                                        webRole="radio"
                                        accessibilityChecked={maxUses === 10}
                                        onPress={() => setMaxUses(10)}
                                        showChevron={false}
                                    />
                                    <Item
                                        testID="public-link-max-uses-50"
                                        title={t('session.sharing.uses50')}
                                        leftElement={<Radio selected={maxUses === 50} />}
                                        selected={maxUses === 50}
                                        accessibilityRole="radio"
                                        webRole="radio"
                                        accessibilityChecked={maxUses === 50}
                                        onPress={() => setMaxUses(50)}
                                        showChevron={false}
                                        showDivider={false}
                                    />
                                </ItemGroup>

                            <ItemGroup>
                                <Item
                                    title={t('session.sharing.requireConsent')}
                                    subtitle={t('session.sharing.requireConsentDescription')}
                                    rightElement={
                                        <Switch
                                            accessibilityLabel={t('session.sharing.requireConsent')}
                                            value={isConsentRequired}
                                            onValueChange={setIsConsentRequired}
                                        />
                                    }
                                    showChevron={false}
                                />
                            </ItemGroup>

                            <View style={styles.section}>
                                <RoundButton
                                    testID="public-link-create"
                                    title={publicShare ? t('session.sharing.regeneratePublicLink') : t('session.sharing.createPublicLink')}
                                    // `action`, not `onPress`: minting a publication token is an
                                    // outward request, and the shared pending lifecycle is what
                                    // refuses the second press that would create a second link
                                    // and orphan the first.
                                    action={handleCreate}
                                    size="large"
                                    style={{ width: '100%', maxWidth: 420, alignSelf: 'center' }}
                                />
                            </View>
                        </>
                    ) : (
                        <>
                            <ItemGroup>
                                <Item
                                    testID="public-link-regenerate"
                                    title={t('session.sharing.regeneratePublicLink')}
                                    // One outward action at a time for the presented link: leaving
                                    // this live would swap the body out from under a revoke that is
                                    // about to close the dialog.
                                    disabled={isRevoking}
                                    onPress={() => {
                                        setIsConfiguring(true);
                                        requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
                                    }}
                                    icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.accent.blue} />}
                                />
                            </ItemGroup>

                            {shareUrl ? (
                                <View style={styles.qrSection}>
                                    <QRCode data={shareUrl} size={250} />
                                </View>
                            ) : null}

                            {shareUrl ? (
                                <ItemGroup>
                                    <Item
                                        testID="public-link-url"
                                        title={t('session.sharing.publicLink')}
                                        subtitle={<Text selectable>{shareUrl}</Text>}
                                        subtitleLines={0}
                                        onPress={handleOpenLink}
                                    />
                                    <Item
                                        title={t('common.copy')}
                                        icon={<Icon name="copy" size={29} color={theme.colors.accent.blue} />}
                                        onPress={handleCopyLink}
                                        rightElement={<CopiedPill visible={copyFeedback.isCopied('public-link')} testID="public-link-copy-feedback" />}
                                        showChevron={false}
                                        showDivider={false}
                                    />
                                </ItemGroup>
                            ) : null}

                            <ItemGroup>
                                {publicShare.token ? (
                                    <Item
                                        title={t('session.sharing.linkToken')}
                                        subtitle={publicShare.token}
                                        subtitleLines={1}
                                        showChevron={false}
                                    />
                                ) : (
                                    <Item
                                        title={t('session.sharing.tokenNotRecoverable')}
                                        subtitle={t('session.sharing.tokenNotRecoverableDescription')}
                                        showChevron={false}
                                    />
                                )}

                                {publicShare.expiresAt ? (
                                    <Item
                                        title={t('session.sharing.expiresOn')}
                                        subtitle={formatDate(publicShare.expiresAt)}
                                        showChevron={false}
                                    />
                                ) : null}

                                <Item
                                    title={t('session.sharing.usageCount')}
                                    subtitle={
                                        publicShare.maxUses
                                            ? t('session.sharing.usageCountWithMax', {
                                                used: publicShare.useCount,
                                                max: publicShare.maxUses,
                                            })
                                            : t('session.sharing.usageCountUnlimited', {
                                                used: publicShare.useCount,
                                            })
                                    }
                                    showChevron={false}
                                />
                                <Item
                                    title={t('session.sharing.requireConsent')}
                                    subtitle={publicShare.isConsentRequired ? t('common.yes') : t('common.no')}
                                    showChevron={false}
                                    showDivider={false}
                                />
                            </ItemGroup>

                            <ItemGroup>
                                <Item
                                    testID="public-link-delete"
                                    title={t('session.sharing.deletePublicLink')}
                                    onPress={handleDelete}
                                    // The shared row pending presentation: the control says it is
                                    // working instead of silently swallowing a second press.
                                    disabled={isRevoking}
                                    loading={isRevoking}
                                    destructive
                                    showDivider={false}
                                />
                            </ItemGroup>
                        </>
                    )}
            </ScrollView>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    body: {
        flex: 1,
        minHeight: 0,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 16,
        flexGrow: 1,
    },
    section: {
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    descriptionText: {
        color: theme.colors.text.secondary,
        fontSize: Platform.select({ ios: 15, default: 14 }),
        lineHeight: 20,
        letterSpacing: Platform.select({ ios: -0.24, default: 0.1 }),
        ...Typography.default(),
    },
    qrSection: {
        paddingHorizontal: 16,
        paddingTop: 12,
        alignItems: 'center',
    },
    radioOuter: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioActive: {
        borderColor: theme.colors.radio.active,
    },
    radioInactive: {
        borderColor: theme.colors.radio.inactive,
    },
    radioDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.radio.dot,
    },
}));
