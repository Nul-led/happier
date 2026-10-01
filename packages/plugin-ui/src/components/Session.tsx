import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';

import { useOptionalPluginUiPresentationHost } from '../presentationHost/context.js';
import { useOptionalHappierTabPanelActivityInternal } from '../presentation/navigation/Tabs.js';

export type SessionProviderProps = Readonly<{
  /** A Session in the mounting surface's Account. The host resolves it; nothing else is trusted. */
  sessionId: string;
  /** Narrow to a live read-only view: no composer, prompts not actionable here. Default false. */
  readOnly?: boolean;
  children: ReactNode;
  /** Rendered instead of `children` when this host cannot present a Session. */
  fallback?: ReactNode;
}>;

export type SessionPartProps = Readonly<{ testID?: string }>;

export type SessionChatProps = Readonly<{
  sessionId: string;
  /** 'chat' (default) = provider + transcript + composer; 'transcript' = read-only provider + transcript. */
  variant?: 'chat' | 'transcript';
  fallback?: ReactNode;
  testID?: string;
}>;

type SessionPartKind = 'transcript' | 'composer';

/**
 * The enclosing `SessionProvider`, as far as this package knows it: which part slot each kind is
 * held by. A part outside a provider, or a second part of a kind inside one, renders nothing and
 * never reaches the host (one controller, at most one of each part).
 */
type SessionPartClaims = Readonly<{
  subscribe(listener: () => void): () => void;
  owner(part: SessionPartKind): string | null;
  claim(part: SessionPartKind, id: string): void;
  release(part: SessionPartKind, id: string): void;
}>;

function createSessionPartClaims(): SessionPartClaims {
  const owners: Record<SessionPartKind, string | null> = { transcript: null, composer: null };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    owner: (part) => owners[part],
    claim(part, id) {
      if (owners[part] !== null) return;
      owners[part] = id;
      emit();
    },
    release(part, id) {
      if (owners[part] !== id) return;
      owners[part] = null;
      emit();
    },
  };
}

const SessionPartClaimsContext = createContext<SessionPartClaims | null>(null);
const NO_SUBSCRIPTION = () => () => undefined;

function useSessionPartClaim(part: SessionPartKind): boolean {
  const claims = useContext(SessionPartClaimsContext);
  const id = useId();
  const readOwner = useCallback(() => claims?.owner(part) ?? null, [claims, part]);
  const owner = useSyncExternalStore(claims?.subscribe ?? NO_SUBSCRIPTION, readOwner, readOwner);
  useLayoutEffect(() => {
    if (!claims || owner !== null) return;
    claims.claim(part, id);
  }, [claims, id, owner, part]);
  useLayoutEffect(() => () => claims?.release(part, id), [claims, id, part]);
  return claims !== null && owner === id;
}

function normalizeSessionId(sessionId: string): string {
  return typeof sessionId === 'string' ? sessionId.trim() : '';
}

/**
 * The one host controller for one Session. Arrange `SessionTranscript` and `SessionComposer` inside
 * it however the surface needs; they are views of this controller, never separate bindings.
 */
export function SessionProvider(props: SessionProviderProps): ReactElement | null {
  const tabActivity = useOptionalHappierTabPanelActivityInternal();
  const host = useOptionalPluginUiPresentationHost();
  const renderSessionPart = host?.renderSessionPart;
  const [claims] = useState(createSessionPartClaims);
  const sessionId = normalizeSessionId(props.sessionId);
  if (!renderSessionPart || sessionId.length === 0) return <>{props.fallback ?? null}</>;
  return (
    <>
      {renderSessionPart(Object.freeze({
        part: 'provider',
        sessionId,
        readOnly: props.readOnly === true,
        ...(tabActivity ? { presented: tabActivity.active } : {}),
        children: (
          <SessionPartClaimsContext.Provider value={claims}>
            {props.children}
          </SessionPartClaimsContext.Provider>
        ),
      }))}
    </>
  );
}

function SessionPart(props: SessionPartProps & Readonly<{ part: SessionPartKind }>): ReactElement | null {
  const host = useOptionalPluginUiPresentationHost();
  const owns = useSessionPartClaim(props.part);
  const renderSessionPart = host?.renderSessionPart;
  if (!renderSessionPart || !owns) return null;
  return (
    <>
      {renderSessionPart(Object.freeze({
        part: props.part,
        ...(props.testID === undefined ? {} : { testID: props.testID }),
      }))}
    </>
  );
}

/** Live transcript with its prompts; fills the remaining height of its bounded flex column. */
export function SessionTranscript(props: SessionPartProps): ReactElement | null {
  return <SessionPart part="transcript" {...props} />;
}

/** The Session's composer at its natural height; renders nothing only for a read-only provider. */
export function SessionComposer(props: SessionPartProps): ReactElement | null {
  return <SessionPart part="composer" {...props} />;
}

/**
 * A live Session in the host's standard layout: transcript, prompts and composer exactly as the full
 * Session view draws them. `variant="transcript"` is the read-only view. It fills a bounded region.
 */
export function SessionChat(props: SessionChatProps): ReactElement | null {
  const tabActivity = useOptionalHappierTabPanelActivityInternal();
  const host = useOptionalPluginUiPresentationHost();
  const renderSessionPart = host?.renderSessionPart;
  const sessionId = normalizeSessionId(props.sessionId);
  if (!renderSessionPart || sessionId.length === 0) return <>{props.fallback ?? null}</>;
  return (
    <>
      {renderSessionPart(Object.freeze({
        part: 'chat',
        sessionId,
        readOnly: props.variant === 'transcript',
        ...(tabActivity ? { presented: tabActivity.active } : {}),
        ...(props.testID === undefined ? {} : { testID: props.testID }),
      }))}
    </>
  );
}
