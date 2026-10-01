import * as React from 'react';

import { PaneLoadingFallback } from '@/components/ui/panels/PaneLoadingFallback';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { t } from '@/text';

export type SessionPaneLazyLoaderProps<TProps extends object> = Readonly<{
    testID: string;
    load: () => Promise<React.ComponentType<TProps>>;
    props: TProps;
}>;

type PaneFailureCode = 'pane_module_load_failed' | 'pane_render_failed';

/** A pane whose code failed to load or whose render threw: it fails alone, says so and retries. */
function PaneFailure(props: Readonly<{ testID: string; code: PaneFailureCode; onRetry: () => void }>) {
    return (
        <SurfaceStateCard
            testID={`${props.testID}-error`}
            kind="error"
            title={t('surfaceState.paneFailedTitle')}
            reason={t('surfaceState.paneFailedReason')}
            diagnosticCode={props.code}
            action={{ label: t('surfaceState.tryAgain'), onPress: props.onRetry }}
        />
    );
}

export class SessionPaneErrorBoundary extends React.Component<
    Readonly<{ testID: string; children: React.ReactNode }>,
    Readonly<{ failed: boolean }>
> {
    state = { failed: false };

    static getDerivedStateFromError() { return { failed: true }; }

    render() {
        return this.state.failed
            ? <PaneFailure testID={this.props.testID} code="pane_render_failed" onRetry={() => this.setState({ failed: false })} />
            : this.props.children;
    }
}

export function SessionPaneLazyLoader<TProps extends object>(input: SessionPaneLazyLoaderProps<TProps>) {
    const [Impl, setImpl] = React.useState<React.ComponentType<TProps> | null>(null);
    const [retryNonce, setRetryNonce] = React.useState(0);
    const [error, setError] = React.useState<unknown>(null);

    React.useEffect(() => {
        let cancelled = false;
        setError(null);
        void input.load()
            .then((mod) => {
                if (cancelled) return;
                setImpl(() => mod);
            })
            .catch((loadError) => {
                if (cancelled) return;
                setError(loadError);
            });
        return () => {
            cancelled = true;
        };
    }, [input.load, retryNonce]);

    if (error) return <PaneFailure testID={input.testID} code="pane_module_load_failed" onRetry={() => {
        setImpl(null);
        setError(null);
        setRetryNonce((value) => value + 1);
    }} />;

    if (!Impl) return <PaneLoadingFallback testID={input.testID} />;

    return <SessionPaneErrorBoundary testID={input.testID}>{React.createElement(Impl, input.props)}</SessionPaneErrorBoundary>;
}
