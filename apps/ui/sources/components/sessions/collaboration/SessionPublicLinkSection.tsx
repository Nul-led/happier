import * as React from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text } from '@/components/ui/text/Text';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SharingAuthoritySession } from '@/sync/domains/social/sessionSharingMutationAuthority';
import { t } from '@/text';

import type { ExternalSessionSharingAvailability } from '@/components/sessions/external/sharing/useExternalSessionSharingAvailability';
import { useSessionPublicLinkController } from './useSessionPublicLinkController';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';

/**
 * Publication, rendered beside named access rather than inside it.
 *
 * A public link is an anonymous, view-only bearer capability: it is not a
 * principal, it grants no input, and it never appears as an access row. The
 * section therefore owns only a calm status/action group and hands every
 * detailed control to the incumbent advanced publication dialog. The secret
 * token is deliberately never rendered here.
 *
 * It fetches nothing without the explicit `managePublicLink` capability, so an
 * ordinary collaborator neither sees publication state nor produces avoidable
 * owner-only rejections.
 */
export function SessionPublicLinkSection(props: Readonly<{
    scope: ServerAccountScope;
    sessionId: string;
    session: SharingAuthoritySession | null;
    availability: ExternalSessionSharingAvailability;
    testID?: string;
}>): React.ReactElement | null {
    const { theme } = useUnistyles();
    // The row is the invoking control: the publication dialog is a modal, and
    // the shared modal host returns focus only to an explicit trigger ref.
    const triggerRef = React.useRef<React.ComponentRef<typeof Pressable> | null>(null);
    // The canonical exact-server decision owner, like every sibling section:
    // a raw snapshot bit would be a second, fail-open reading of the same fact.
    const publicLinkEnabled = useFeatureEnabled('sharing.public', {
        scopeKind: 'spawn',
        serverId: props.scope.serverId,
    });
    const controller = useSessionPublicLinkController({
        scope: props.scope,
        sessionId: props.sessionId,
        session: props.session,
        availability: props.availability,
        publicLinkEnabled,
    });

    // Publication management is owner-scoped; without it there is no
    // content-safe status to state, so the section stays absent rather than
    // rendering a dead control.
    if (!controller.canManage) return null;

    const publicShare = controller.publicShare;
    const status = publicShare ? t('session.sharing.publicLinkActive') : t('common.off');
    const detail = publicShare
        ? [
            publicShare.expiresAt
                ? `${t('session.sharing.expiresOn')}: ${new Date(publicShare.expiresAt).toLocaleDateString()}`
                : t('session.sharing.never'),
            typeof publicShare.maxUses === 'number'
                ? t('session.sharing.usageCountWithMax', { used: publicShare.useCount, max: publicShare.maxUses })
                : t('session.sharing.usageCountUnlimited', { used: publicShare.useCount }),
        ].join(' · ')
        : t('session.sharing.publicLinkDescription');

    return (
        <ItemGroup title={t('session.sharing.publicLink')}>
            {(!controller.error || controller.hasLoaded) ? (
                <Item
                    testID={props.testID ?? 'session-public-link-row'}
                    pressableRef={triggerRef}
                    title={t('session.sharing.publicLink')}
                    subtitle={<Text testID="session-public-link-status">{status}</Text>}
                    subtitleLines={2}
                    icon={<Icon name="link" size={29} color={publicShare ? theme.colors.state.success.foreground : theme.colors.text.secondary} />}
                    // Quiet trailing metadata: the link's own limits when it is
                    // active, and nothing but progress during the first read.
                    detail={controller.loading ? t('common.loading') : publicShare ? detail : undefined}
                    detailTestID="session-public-link-detail"
                    accessibilityLabel={`${t('session.sharing.publicLink')}. ${status}. ${detail}`}
                    showChevron={controller.canOpen}
                    disabled={!controller.canOpen}
                    onPress={controller.canOpen ? () => { void controller.openEditor(triggerRef); } : undefined}
                />
            ) : null}
            {controller.error ? (
                <Item
                    testID="session-public-link-retry"
                    title={t('errors.operationFailed')}
                    subtitle={t('common.retry')}
                    icon={<Icon name="warning-circle" size={29} color={theme.colors.state.warning.foreground} />}
                    onPress={() => { void controller.reload(); }}
                    showChevron={false}
                />
            ) : null}
        </ItemGroup>
    );
}
