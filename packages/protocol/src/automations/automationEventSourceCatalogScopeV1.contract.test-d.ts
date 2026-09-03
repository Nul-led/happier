import type { AutomationEventSourceCatalogScopeV1 } from './automationActionSpecsV1.js';
import type { AutomationObservationTransportKindV1 } from './automationEventDeclarationV1.js';

type Assert<Condition extends true> = Condition;
type IsExactly<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left] ? true : false
  : false;

// One reconciling catalog reporter exists per observation transport, and the
// persisted scope key is derived from this union. Losing a transport kind here
// is what previously made a socket catalog-status row unrepresentable.
type _AutomationEventSourceCatalogScopeCoversEveryTransport = Assert<
  IsExactly<AutomationEventSourceCatalogScopeV1['kind'], AutomationObservationTransportKindV1>
>;
