import { describe, expect, it } from 'vitest';

import { ACTION_IDS } from '@happier-dev/protocol';

import { t } from '@/text';

import {
    SESSION_ACTION_ARCHIVE_ID,
    SESSION_ACTION_DELETE_ID,
    SESSION_ACTION_EDIT_TAGS_ID,
    SESSION_ACTION_MARK_READ_ID,
    SESSION_ACTION_MARK_UNREAD_ID,
    SESSION_ACTION_MOVE_TO_FOLDER_ID,
    SESSION_ACTION_PIN_ID,
    SESSION_ACTION_RENAME_ID,
    SESSION_ACTION_STOP_ID,
    SESSION_ACTION_UNARCHIVE_ID,
    SESSION_ACTION_UNPIN_ID,
} from './sessionActionIds';
import { getSessionActionMetadata } from './sessionActionMetadata';
import { createSessionActionInfoItemProps, resolveSessionDeleteWarning } from './sessionActionPresentation';
import { SESSION_BULK_ACTION_IDS } from './sessionBulkActionTypes';

describe('session action presentation', () => {
    it('discloses deferred cleanup for an offline managed session without exposing its private path', () => {
        const input = {
            defaultWarning: 'delete session',
            offlineManagedWarning: 'cleanup waits for reconnect',
            machineOnline: false,
        };
        const metadata = { path: '/private/session-root', sessionDirectoryV1: { v: 1, kind: 'managed' } };
        const warning = resolveSessionDeleteWarning({ ...input, metadata });
        expect(warning).toBe('delete session\n\ncleanup waits for reconnect');
        expect(warning).not.toContain(metadata.path);
        expect(resolveSessionDeleteWarning({ ...input, metadata: {} })).toBe(input.defaultWarning);
        expect(resolveSessionDeleteWarning({ ...input, metadata, machineOnline: true })).toBe(input.defaultWarning);
    });
    it('uses unarchive-specific info copy', () => {
        const props = createSessionActionInfoItemProps({
            actionId: SESSION_ACTION_UNARCHIVE_ID,
        });

        expect(props?.title).toBe(t('sessionInfo.unarchiveSession'));
        expect(props?.subtitle).toBe(t('sessionInfo.unarchiveSessionSubtitle'));
    });

    it('uses one metadata source for shared single and bulk actions', () => {
        expect(getSessionActionMetadata(SESSION_BULK_ACTION_IDS.stop)).toBe(getSessionActionMetadata(SESSION_ACTION_STOP_ID));
        expect(getSessionActionMetadata(SESSION_BULK_ACTION_IDS.archive)).toBe(getSessionActionMetadata(SESSION_ACTION_ARCHIVE_ID));
        expect(getSessionActionMetadata(SESSION_BULK_ACTION_IDS.markRead)).toBe(getSessionActionMetadata(SESSION_ACTION_MARK_READ_ID));
    });

    it('keeps UI-local session action ids out of the protocol action namespace', () => {
        const protocolActionIds = new Set<string>(ACTION_IDS);
        const uiSessionActionIds = [
            SESSION_ACTION_MARK_READ_ID,
            SESSION_ACTION_MARK_UNREAD_ID,
            SESSION_ACTION_RENAME_ID,
            SESSION_ACTION_STOP_ID,
            SESSION_ACTION_ARCHIVE_ID,
            SESSION_ACTION_UNARCHIVE_ID,
            SESSION_ACTION_DELETE_ID,
            SESSION_ACTION_PIN_ID,
            SESSION_ACTION_UNPIN_ID,
            SESSION_ACTION_EDIT_TAGS_ID,
            SESSION_ACTION_MOVE_TO_FOLDER_ID,
            ...Object.values(SESSION_BULK_ACTION_IDS),
        ];

        expect(uiSessionActionIds.filter((id) => protocolActionIds.has(id))).toEqual([]);
    });
});
