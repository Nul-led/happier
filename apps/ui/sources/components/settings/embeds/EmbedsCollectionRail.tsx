import * as React from 'react';
import type { AccountApiTokenSummaryV1 } from '@happier-dev/protocol';
import { usePathname, useRouter } from '@/components/appShell/workspace/destinationRoute';

import { useApiTokenSettingsScopeController } from '@/components/settings/apiTokens/collection/ApiTokenSettingsScope';
import { useApiTokenSettingsClock } from '@/components/settings/apiTokens/useApiTokenSettingsClock';
import { useApiTokenSettingsControllerState } from '@/components/settings/apiTokens/useApiTokenSettingsControllerState';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { CollectionList } from '@/components/ui/lists/collection/CollectionList';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { useHostActivelyViewed } from '@/utils/runtime/useHostActivelyViewed';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { EmbedRow } from './EmbedRow';
import { EMBEDS_NEW_PATH, embedDetailPath, isEmbedToken, resolveSelectedEmbedTokenId } from './embedsCollection';
import { useEmbedSummaryNames } from './useEmbedSummaryNames';

/** The embeds rail beside an embed's detail, with "+" to start a new one. */
export const EmbedsCollectionRail = React.memo(function EmbedsCollectionRail() {
    const state = useApiTokenSettingsControllerState(useApiTokenSettingsScopeController());
    const embeds = React.useMemo(() => state.tokens.filter(isEmbedToken), [state.tokens]);
    const router = useRouter();
    const selectedId = resolveSelectedEmbedTokenId(usePathname().replace(/\/+$/, ''));
    const names = useEmbedSummaryNames();
    const nowMs = useApiTokenSettingsClock(embeds, useHostActivelyViewed());

    const navigate = React.useCallback((href: string, tag: string) => {
        const result = runGuardedNavigation(() => router.replace(href as never));
        if (result !== true) fireAndForget(result, { tag });
    }, [router]);
    const open = React.useCallback((token: AccountApiTokenSummaryV1) => navigate(embedDetailPath(token.tokenId), 'EmbedsCollectionRail.open'), [navigate]);

    return (
        <CollectionList
            testID="settings-embeds-rail"
            title={t('settingsEmbeds.title')}
            count={state.phase === 'ready' ? embeds.length : null}
            headerAction={(
                <IconButton
                    testID="settings-embeds-rail-create"
                    iconName="plus"
                    variant="plain"
                    accessibilityLabel={t('settingsEmbeds.newEmbed')}
                    tooltip={t('settingsEmbeds.newEmbed')}
                    onPress={() => navigate(EMBEDS_NEW_PATH, 'EmbedsCollectionRail.create')}
                />
            )}
        >
            {embeds.map((token) => (
                <EmbedRow
                    key={token.tokenId}
                    token={token}
                    names={names}
                    nowMs={nowMs}
                    variant="rail"
                    selected={selectedId === token.tokenId}
                    onPress={open}
                />
            ))}
        </CollectionList>
    );
});
