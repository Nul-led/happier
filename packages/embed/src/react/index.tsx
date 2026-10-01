import { createElement, useEffect, useRef } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { mountHappierSession } from '../mount.js';
import type { EmbedHandle, EmbedOptions } from '../types.js';

export type HappierSessionProps = EmbedOptions & {
  className?: string;
  containerStyle?: CSSProperties;
};

/** The style prop configures the inner chat; containerStyle sizes the host box. */
export function HappierSession(props: HappierSessionProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<EmbedHandle | null>(null);
  const latest = useRef(props);
  const currentTarget = useRef(props.sessionId ?? null);
  const suppliedTarget = useRef(props.sessionId);
  latest.current = props;
  useEffect(() => {
    if (!container.current) return;
    // A simultaneous URL/target change must mount the new target, while an
    // unchanged null prop preserves the session adopted from the frame.
    if (suppliedTarget.current !== latest.current.sessionId) currentTarget.current = latest.current.sessionId ?? null;
    const instance = mountHappierSession(container.current, {
      ...latest.current,
      sessionId: currentTarget.current,
      getCredential: (request) => latest.current.getCredential(request),
      onStateChange: (state) => {
        if (currentTarget.current === null && state.phase === 'ready') currentTarget.current = state.sessionId;
        latest.current.onStateChange?.(state);
      },
      onSessionCreated: (event) => latest.current.onSessionCreated?.(event),
      onError: (error) => latest.current.onError?.(error),
    });
    handle.current = instance;
    return () => { instance.destroy(); if (handle.current === instance) handle.current = null; };
  }, [props.happierUrl]);
  useEffect(() => {
    suppliedTarget.current = props.sessionId;
    currentTarget.current = props.sessionId ?? null;
    handle.current?.open(currentTarget.current);
  }, [props.sessionId]);
  useEffect(() => {
    handle.current?.update({ title: props.title, ui: props.ui, style: props.style });
  }, [props.title, props.ui, props.style]);
  return createElement('div', { ref: container, className: props.className, style: { width: '100%', height: '100%', ...props.containerStyle } });
}
