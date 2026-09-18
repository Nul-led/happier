import type { ActionId } from '../../../actions/actionIds.js';
import {
  normalizeDeclarativeDocumentV1Core,
  type PluginDeclarativeDocumentNormalizationV1,
} from '../../../plugins/contributions/ui/declarativeDocument.js';

import { SessionSurfaceDeclarativeDocumentV1Schema } from './authoring.js';

/**
 * Normalize Session-authored content through the one declarative traversal.
 * Session records contribute no plugin identity, generation, Settings, Data,
 * composer effect, or targeted-Surface authority.
 */
export function normalizeSessionSurfaceDeclarativeDocumentV1(input: Readonly<{
  document: unknown;
  admittedHostActions: readonly ActionId[];
}>): PluginDeclarativeDocumentNormalizationV1 {
  const document = SessionSurfaceDeclarativeDocumentV1Schema.parse(input.document);
  return normalizeDeclarativeDocumentV1Core({
    kind: 'session',
    document,
    admittedHostActions: input.admittedHostActions,
  });
}
