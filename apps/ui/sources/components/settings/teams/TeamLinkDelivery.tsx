import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { QRCode } from '@/components/qr';
import { tryCreateQRMatrix } from '@/components/qr/qrMatrix';
import { CopiedPill } from '@/components/ui/copy/CopiedPill';
import { useTemporaryCopyFeedback } from '@/components/ui/copy/useTemporaryCopyFeedback';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import { t } from '@/text';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import { isTextSharingAvailable, shareTextSafe } from '@/utils/ui/shareText';

/**
 * The one way a Team link is handed to a person.
 *
 * Two links reach a member: the invitation bearer, which is a secret handed over
 * exactly once at creation or reissue, and the ordinary member sign-in page,
 * which carries no bearer and may be published anywhere. They differ in what
 * they authorize and therefore in their copy — but not in *how* they are handed
 * over. Keeping copy, share and QR in one component is what stops those two from
 * drifting into offering different deliveries of the same shape, which is the
 * kind of difference nobody notices until a manager cannot scan the link they
 * were just shown.
 *
 * The URL is rendered, never stored: it lives in the calling screen's memory for
 * as long as that screen can legitimately hand it over.
 */

const QR_SIZE = 180;

const TeamLinkQr = React.memo(function TeamLinkQr(props: Readonly<{
    url: string;
    accessibilityLabel: string;
    testID: string;
}>) {
    // The encoder owns its own capacity rule, and its shared non-throwing
    // boundary is asked *before* the renderer is mounted. Wrapping the element
    // in try/catch would not work at all — the child renders after this
    // function returns — and approximating the limit from the link's length
    // would be a second, wrong answer to a question the encoder already owns.
    const encodable = React.useMemo(
        () => tryCreateQRMatrix(props.url, 'medium').ok,
        [props.url],
    );

    if (!encodable) {
        return (
            <Item
                testID={`${props.testID}-too-large`}
                title={t('teams.invitations.qrTooLargeFallback')}
                showChevron={false}
            />
        );
    }

    return (
        <View
            testID={props.testID}
            accessible
            accessibilityLabel={props.accessibilityLabel}
            style={styles.qr}
        >
            <QRCode data={props.url} size={QR_SIZE} />
        </View>
    );
});

export const TeamLinkDelivery = React.memo(function TeamLinkDelivery(props: Readonly<{
    url: string;
    /** Distinguishes the surfaces that hand a link over, so a test can tell them apart. */
    testIDPrefix: string;
    title: string;
    copyLabel: string;
    shareLabel: string;
    qrAccessibilityLabel: string;
    /**
     * When supplied, QR delivery is an explicit action instead of an always-open
     * panel. Member sign-in uses this compact form; one-time invitation handoff
     * keeps the QR visible immediately.
     */
    qrActionLabel?: string;
    footer?: string;
    /**
     * An in-app preview of where the link lands. Only a link the app itself can
     * route offers one; an invitation bearer is handed over, not opened by the
     * person holding the administration screen.
     */
    open?: Readonly<{ label: string; onPress: () => void }>;
}>) {
    const copyFeedback = useTemporaryCopyFeedback();
    const [qrRevealed, setQrRevealed] = React.useState(props.qrActionLabel === undefined);
    const { url } = props;
    // Asked once per render rather than per press: a control that is offered and
    // then does nothing is worse than one that was never offered.
    const sharingAvailable = isTextSharingAvailable();

    const copy = React.useCallback(async () => {
        const copied = await setClipboardStringSafe(url);
        if (!copied) {
            await Modal.alertAsync(t('common.error'), t('items.failedToCopyToClipboard'));
            return;
        }
        copyFeedback.markCopied();
    }, [url, copyFeedback]);

    const share = React.useCallback(async () => {
        if (await shareTextSafe(url) === 'unavailable') {
            await Modal.alertAsync(t('common.error'), t('teams.invitations.shareUnavailable'));
        }
    }, [url]);

    return (
        <ItemGroup title={props.title} footer={props.footer}>
            {props.open ? (
                <Item
                    testID={`${props.testIDPrefix}-open`}
                    title={props.open.label}
                    onPress={props.open.onPress}
                    showChevron
                />
            ) : null}
            <Item
                testID={`${props.testIDPrefix}-copy-link`}
                title={props.copyLabel}
                rightElement={(
                    <CopiedPill
                        visible={copyFeedback.isCopied()}
                        testID={`${props.testIDPrefix}-copy-link-copied`}
                    />
                )}
                onPress={copy}
                showChevron={false}
            />
            {sharingAvailable ? (
                <Item
                    testID={`${props.testIDPrefix}-share-link`}
                    title={props.shareLabel}
                    onPress={share}
                    showChevron={false}
                />
            ) : null}
            {props.qrActionLabel ? (
                <Item
                    testID={`${props.testIDPrefix}-show-qr`}
                    title={props.qrActionLabel}
                    accessibilityExpanded={qrRevealed}
                    onPress={() => setQrRevealed((visible) => !visible)}
                    showChevron={false}
                />
            ) : null}
            {qrRevealed ? (
                <TeamLinkQr
                    url={url}
                    accessibilityLabel={props.qrAccessibilityLabel}
                    testID={`${props.testIDPrefix}-qr`}
                />
            ) : null}
        </ItemGroup>
    );
});

const styles = StyleSheet.create(() => ({
    qr: {
        alignSelf: 'center',
        paddingVertical: 12,
    },
}));
