import { readSessionDirectoryKind } from '@happier-dev/protocol';
import { t } from '@/text';
import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { readSessionListRowForServerId } from '@/sync/domains/session/listing/sessionListRowStateLookup';
import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import { getStorage } from '@/sync/domains/state/storageStore';
import type { StorageState } from '@/sync/store/types';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { resolveSessionWorkspaceDisplayPresentation } from '@/sync/domains/session/listing/sessionWorkspaceDisplayPresentation';
import type { WorkspacePathDisplayModeV1 } from '@/sync/domains/workspaces/workspaceDisplayPresentation';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';

import { sessionTagKey } from './sessionTagUtils';

const EMPTY_SEARCH_TEXT_BY_SESSION_KEY: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_SEARCH_TEXT_PROJECTION = Object.freeze({
    searchableTextBySessionKey: EMPTY_SEARCH_TEXT_BY_SESSION_KEY,
    primarySearchableTextBySessionKey: EMPTY_SEARCH_TEXT_BY_SESSION_KEY,
});

export type SessionListSearchTextProjection = Readonly<{
    searchableTextBySessionKey: Readonly<Record<string, string>>;
    primarySearchableTextBySessionKey: Readonly<Record<string, string>>;
}>;

type SessionSearchKey = Readonly<{
    serverId: string;
    sessionId: string;
    key: string;
}>;

type SearchableSessionMetadata = Readonly<{
    name?: string | null;
    path?: string | null;
    sessionDirectoryV1?: unknown;
    host?: string | null;
    machineId?: string | null;
}>;

type SessionListSearchOrganization = Readonly<{
    sessionTags: Readonly<Record<string, ReadonlyArray<string>>>;
    workspaceRefs: ReadonlyArray<WorkspaceRefV1>;
    workspacePathDisplayModeV1?: WorkspacePathDisplayModeV1 | null;
}>;

function appendText(parts: string[], value: string | null | undefined): void {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length > 0) parts.push(trimmed);
}

function appendSessionMetadataText(parts: string[], metadata: SearchableSessionMetadata | null | undefined): void {
    appendText(parts, metadata?.name);
    // A no-folder session is found as a chat; its private folder is never indexed.
    if (readSessionDirectoryKind(metadata) === 'managed') appendText(parts, t('session.folderless.chats'));
    else appendText(parts, metadata?.path);
    appendText(parts, metadata?.host);
    appendText(parts, metadata?.machineId);
}

function appendRenderableText(parts: string[], renderable: SessionListRenderableSession | null | undefined): void {
    appendSessionMetadataText(parts, renderable?.metadata ?? null);
}

export function buildCanonicalSessionListSearchText(input: Readonly<{
    sessionId: string;
    renderable?: SessionListRenderableSession | null;
    session?: Session | null;
    tags?: ReadonlyArray<string>;
    workspaceDisplayLabel?: string | null;
}>): string {
    const parts: string[] = [];
    appendText(parts, input.sessionId);
    appendRenderableText(parts, input.renderable);
    appendSessionMetadataText(parts, input.session ? readSessionOwnerMetadataView(input.session) : null);
    for (const tag of input.tags ?? []) appendText(parts, tag);
    appendText(parts, input.workspaceDisplayLabel);
    return parts.join('\n');
}

export function buildCanonicalSessionListPrimarySearchText(input: Readonly<{
    sessionId: string;
    renderable?: SessionListRenderableSession | null;
    session?: Session | null;
    workspaceDisplayLabel?: string | null;
}>): string {
    const parts: string[] = [];
    appendText(parts, input.sessionId);
    const renderableMetadata = input.renderable?.metadata ?? null;
    appendText(parts, renderableMetadata?.name);
    const ownerMetadata = input.session ? readSessionOwnerMetadataView(input.session) : null;
    appendText(parts, ownerMetadata?.name);
    appendText(parts, input.workspaceDisplayLabel);
    return parts.join('\n');
}

function collectSessionKeys(items: ReadonlyArray<SessionListIndexItem>): ReadonlyArray<SessionSearchKey> {
    const keys: SessionSearchKey[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        if (item.type !== 'session') continue;
        const serverId = String(item.serverId ?? '').trim();
        const sessionId = String(item.sessionId ?? '').trim();
        if (!serverId || !sessionId) continue;
        const key = sessionTagKey(serverId, sessionId);
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push({ serverId, sessionId, key });
    }
    return keys;
}

function buildSearchTextProjection(
    state: StorageState,
    sessionKeys: ReadonlyArray<SessionSearchKey>,
    organization?: SessionListSearchOrganization,
): SessionListSearchTextProjection {
    const out: Record<string, string> = {};
    const primary: Record<string, string> = {};
    for (const entry of sessionKeys) {
        // Session ids are source-local. Contextual search consumes only the
        // exact server partition; bare-id global Session/renderable maps could
        // otherwise leak another Home's same-id metadata into this haystack.
        const renderable = readSessionListRowForServerId(
            state.sessionListRowsByServerId,
            entry.serverId,
            entry.sessionId,
        );
        const metadata = renderable?.metadata ?? null;
        const workspaceDisplayLabel = organization
            ? resolveSessionWorkspaceDisplayPresentation({
                serverId: entry.serverId,
                metadata,
                workspaceRefs: organization.workspaceRefs,
                workspacePathDisplayModeV1: organization.workspacePathDisplayModeV1,
            }).displayTitle
            : null;
        const text = buildCanonicalSessionListSearchText({
            sessionId: entry.sessionId,
            renderable,
            tags: organization?.sessionTags[entry.key],
            workspaceDisplayLabel,
        });
        if (text) out[entry.key] = text;
        const primaryText = buildCanonicalSessionListPrimarySearchText({
            sessionId: entry.sessionId,
            renderable,
            workspaceDisplayLabel,
        });
        if (primaryText) primary[entry.key] = primaryText;
    }

    return {
        searchableTextBySessionKey: Object.keys(out).length > 0 ? out : EMPTY_SEARCH_TEXT_BY_SESSION_KEY,
        primarySearchableTextBySessionKey: Object.keys(primary).length > 0 ? primary : EMPTY_SEARCH_TEXT_BY_SESSION_KEY,
    };
}

function createSessionListSearchTextProjectionSelector(
    items: ReadonlyArray<SessionListIndexItem>,
    enabled: boolean,
    organization?: SessionListSearchOrganization,
): (state: StorageState) => SessionListSearchTextProjection {
    const sessionKeys = collectSessionKeys(items);
    let previousState: StorageState | null = null;
    let previousDeltaRevision: number | null = null;
    let previousResult: SessionListSearchTextProjection | null = null;

    return (state) => {
        if (!enabled || sessionKeys.length === 0) return EMPTY_SEARCH_TEXT_PROJECTION;
        if (previousResult && previousState === state) return previousResult;
        const renderableDelta = state.sessionListRenderableDelta;
        if (
            previousResult
            && renderableDelta
            && previousDeltaRevision !== null
            && renderableDelta.revision !== previousDeltaRevision
            && renderableDelta.rebuiltSessionListIndex !== true
            && renderableDelta.changedSessionIds.length === 0
            && renderableDelta.removedSessionIds.length === 0
        ) {
            previousState = state;
            previousDeltaRevision = renderableDelta.revision;
            return previousResult;
        }

        previousResult = buildSearchTextProjection(state, sessionKeys, organization);
        previousState = state;
        previousDeltaRevision = renderableDelta?.revision ?? null;
        return previousResult;
    };
}

export function createSessionListSearchTextSelector(
    items: ReadonlyArray<SessionListIndexItem>,
    enabled: boolean,
    organization?: SessionListSearchOrganization,
): (state: StorageState) => Readonly<Record<string, string>> {
    const projectionSelector = createSessionListSearchTextProjectionSelector(items, enabled, organization);
    return (state) => projectionSelector(state).searchableTextBySessionKey;
}

export function useSessionListSearchTextByKey(
    items: ReadonlyArray<SessionListIndexItem>,
    enabled: boolean,
    organization?: SessionListSearchOrganization,
): SessionListSearchTextProjection {
    const selector = React.useMemo(
        () => createSessionListSearchTextProjectionSelector(items, enabled, organization),
        [enabled, items, organization],
    );
    return getStorage()(useShallow(selector));
}
