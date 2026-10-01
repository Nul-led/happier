import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemLoadStateRows } from '@/components/ui/lists/ItemLoadStateRows';
import { useServerRetentionPolicy } from '@/hooks/server/useServerRetentionPolicy';
import { formatServerRetentionRows } from '@/sync/domains/server/retention/formatServerRetentionPolicy';
import { getServerRetentionDomainMetadata } from '@/sync/domains/server/retention/serverRetentionDomainMetadata';
import { normalizeServerRetentionPolicy, type ServerRetentionPolicyView } from '@/sync/domains/server/retention/serverRetentionPolicy';
import { t } from '@/text';

type ServerRetentionSectionProps = Readonly<{
    serverId: string | null;
}>;

/**
 * What the policy that answered lets this page say: the rows of the policies that delete and this
 * client can name, and a statement only when there is nothing to list ("No automatic deletion") or
 * when the answer holds a deleting policy it cannot show (a domain it does not know, or an older
 * Home's incomplete policy).
 */
function resolveRetentionView(policy: ServerRetentionPolicyView) {
    const view = normalizeServerRetentionPolicy(policy);
    if (!view.enabled) return { rows: [], statement: t('server.retention.keepForever') };
    const deleting = view.domains.filter((domain) => domain.policy.mode !== 'keep_forever');
    const nameable = new Set(deleting.filter((domain) => getServerRetentionDomainMetadata(domain.id)).map((domain) => domain.id));
    const rows = formatServerRetentionRows(view).filter((row) => nameable.has(row.key));
    const cannotShowAll = nameable.size < deleting.length || (view.completeness !== 'complete' && rows.length === 0);
    return {
        rows,
        statement: cannotShowAll
            ? t('server.retention.detailsUnavailable')
            : rows.length === 0 ? t('server.retention.keepForever') : null,
    };
}

/**
 * What the Home in use deletes automatically: one row per policy that deletes ("Subagent transcripts —
 * Deletes data after 7 days."). While the policy is being read its rows are reserved; a failed read
 * says so with Retry. It never states a verdict it has not read.
 */
export function ServerRetentionSection(props: ServerRetentionSectionProps) {
    const state = useServerRetentionPolicy(props.serverId);
    const resolved = React.useMemo(
        () => state.status === 'ready' ? resolveRetentionView(state.policy) : null,
        [state],
    );

    if (!props.serverId) return null;

    return (
        <ItemGroup title={t('server.retention.title')}>
            {state.status === 'loading' ? (
                <ItemLoadStateRows
                    testID="server-retention-load"
                    state={{ kind: 'loading' }}
                    rows={1}
                    lines={2}
                    accessibilityLabel={t('server.retention.title')}
                />
            ) : state.status === 'failed' ? (
                <ItemLoadStateRows
                    testID="server-retention-load"
                    state={{
                        kind: 'failed',
                        reason: t('server.retention.readFailed'),
                        onRetry: state.retry,
                        homeServerIds: [props.serverId],
                    }}
                />
            ) : null}
            {resolved?.rows.map((row) => (
                <Item
                    key={row.key}
                    testID={`server-retention-row-${row.key}`}
                    title={row.title}
                    subtitle={row.detail}
                    mode="info"
                    showChevron={false}
                />
            ))}
            {resolved?.statement ? (
                <Item
                    testID="server-retention-summary"
                    title={resolved.statement}
                    titleLines={0}
                    mode="info"
                    showChevron={false}
                />
            ) : null}
        </ItemGroup>
    );
}
