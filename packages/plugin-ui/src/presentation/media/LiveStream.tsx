import type { ReactElement, ReactNode } from 'react';

import { useOptionalPluginUiPresentationHost } from '../../presentationHost/context.js';
import type { HappierStyleProp } from '../portableTypes.js';
import type { PluginLiveStreamReferenceV1 } from './liveStreamReference.js';

export type HappierLiveStreamProps = Readonly<{
  reference: PluginLiveStreamReferenceV1;
  style?: HappierStyleProp;
  testID?: string;
  /** Used where the host cannot present a stream, including a caller-hosted HTML realm. */
  fallback?: ReactNode;
}>;

/**
 * One read-only viewer. The mounted host owns each viewing's Action approval, exact capture
 * occurrence, connection, decoder and cleanup; this component never acquires input authority.
 */
export function HappierLiveStream(props: HappierLiveStreamProps): ReactElement {
  const host = useOptionalPluginUiPresentationHost();
  return <>{host?.renderLiveStream ? host.renderLiveStream(props) : props.fallback ?? null}</>;
}
