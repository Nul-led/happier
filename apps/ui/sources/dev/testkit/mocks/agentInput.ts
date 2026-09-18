import * as React from 'react';

/**
 * The composer host boundary.
 *
 * `AgentInput` is the real composer: it mounts the text engine, dictation,
 * message history, typing presence and the plugin control rail. A test about a
 * surface that *contains* a composer wants the surface's own behavior, not that
 * whole tree, so this replaces the component itself and leaves every owner
 * beneath the surface — the document owner, presentation targets, suggestion
 * resolution and scope projection — running for real.
 *
 * It preserves the two contracts a host actually depends on: text changes are
 * reported back, and the focus-request seam is published so a host that asks a
 * prompt to take focus can be observed doing it.
 */
export function createAgentInputModuleMock(options: Readonly<{
    onRender?: (props: Record<string, unknown>) => void;
    onFocusRequest?: () => void;
    /**
     * A host test's address for this exact composer. The real component takes no
     * `testID`, so a host that mounts several composers supplies one derived
     * from the Composer ref it already owns.
     */
    resolveTestID?: (props: Record<string, unknown>) => string | undefined;
}> = {}) {
    return {
        AgentInput: (props: Record<string, unknown>) => {
            options.onRender?.(props);
            const publishFocusRequest = props.onComposerFocusRequestChange;
            React.useEffect(() => {
                if (typeof publishFocusRequest !== 'function') return;
                publishFocusRequest(() => options.onFocusRequest?.());
                return () => publishFocusRequest(null);
            }, [publishFocusRequest]);
            const testID = options.resolveTestID?.(props);
            return React.createElement('AgentInput', {
                ...(testID === undefined ? {} : { testID }),
                value: props.value,
                placeholder: props.placeholder,
                onChangeText: props.onChangeText,
                composerRef: props.composerRef,
                sessionId: props.sessionId,
                autocompleteKinds: props.autocompleteKinds,
                autocompleteSuggestions: props.autocompleteSuggestions,
            });
        },
    };
}
