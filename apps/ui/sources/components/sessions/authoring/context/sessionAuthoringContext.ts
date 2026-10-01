import type { ExistingSessionAuthoringSnapshotSession } from '@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters';
import type { SessionAuthoringDraft } from '@/components/sessions/authoring/draft/sessionAuthoringDraft';
import type { NewSessionAutomationDraft } from '@/sync/domains/automations/automationDraft';
import type { SessionAuthoringSnapshot } from '@/sync/domains/sessionAuthoring/sessionAuthoringSnapshot';

export type NewSessionAuthoringContext = Readonly<{
    kind: 'newSession';
    draft: SessionAuthoringDraft;
    effectiveAutomationDraft: NewSessionAutomationDraft;
    showAutomationActionChips: boolean;
    canSubmit: boolean;
}>;

export type LiveSessionAuthoringContext = Readonly<{
    kind: 'liveSession';
    session: ExistingSessionAuthoringSnapshotSession;
    snapshot: SessionAuthoringSnapshot;
}>;

export type SessionAuthoringContext =
    | NewSessionAuthoringContext
    | LiveSessionAuthoringContext;
