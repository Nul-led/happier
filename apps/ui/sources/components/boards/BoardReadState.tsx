import * as React from 'react';
import { SurfaceStateCard, type SurfaceStateSize } from '@/components/ui/surfaces/SurfaceStateCard';
import { SurfaceFreshnessLine } from '@/components/ui/surfaces/SurfaceFreshnessLine';
import { t } from '@/text';
import { useWorkBoardReadState } from './model/useWorkBoards';

/** A failed read is never an empty Board collection; last-known Boards remain visible with Retry. */
export function BoardReadState(props: Readonly<{ size?: SurfaceStateSize; retained?: boolean }>) {
    const state = useWorkBoardReadState();
    if (state.status === 'ready') return null;
    const title = state.status === 'loading' ? t('surfaceState.opening', { name: t('boards.title') })
        : t('surfaceState.couldNotOpen', { name: t('boards.title') });
    const action = state.status === 'error' ? { label: t('surfaceState.tryAgain'), onPress: state.retry } : undefined;
    if (props.retained) return <SurfaceFreshnessLine testID="boards-read-stale" reason={title}
        busy={state.status === 'loading'} tone={state.status === 'error' ? 'warning' : 'neutral'} action={action} />;
    return <SurfaceStateCard testID="boards-read-state" kind={state.status === 'loading' ? 'loading' : 'error'}
        size={props.size} title={title} diagnosticCode={state.errorCode} action={action}
        accessibilitySemantics={state.status === 'error' ? 'alert' : 'status'} />;
}
