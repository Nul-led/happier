import type {
    BrowserAutomationActionKindV1,
    BrowserAutomationAdapterCapabilityKindV1,
} from '@happier-dev/protocol';

/** The installed collector's executable contribution, consumed by admission and its command router. */
export const INJECTED_PAGE_AUTOMATION_ACTIONS = [
    { action: 'snapshot', capability: 'snapshot', handler: 'handleAutomationSnapshot' },
    { action: 'semanticSnapshot', capability: 'semanticSnapshot', handler: 'handleAutomationSnapshot' },
    { action: 'queryElements', capability: 'locatorQuery', handler: 'handleAutomationQuery' },
    { action: 'click', capability: 'click', handler: 'handleAutomationClick' },
    { action: 'tap', capability: 'tap', handler: 'handleAutomationClick' },
    { action: 'type', capability: 'type', handler: 'handleAutomationType' },
    { action: 'setValue', capability: 'type', handler: 'handleAutomationType' },
    { action: 'hover', capability: 'hover', handler: 'handleAutomationHover' },
    { action: 'focus', capability: 'type', handler: 'handleAutomationFocus' },
    { action: 'press', capability: 'press', handler: 'handleAutomationPress' },
    { action: 'upload', capability: 'upload', handler: 'handleAutomationUpload' },
    { action: 'drag', capability: 'drag', handler: 'handleAutomationDrag' },
    { action: 'scroll', capability: 'scroll', handler: 'handleAutomationScroll' },
    { action: 'waitFor', capability: 'waitFor', handler: 'handleAutomationWaitFor' },
] as const satisfies ReadonlyArray<Readonly<{
    action: BrowserAutomationActionKindV1;
    capability: BrowserAutomationAdapterCapabilityKindV1;
    handler: string;
}>>;
