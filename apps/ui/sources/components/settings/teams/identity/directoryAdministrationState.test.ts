import { describe, expect, it } from 'vitest';
import type { TeamDirectorySourceSummaryV1 } from '@happier-dev/protocol/teams';

import {
    beginDirectoryAdministrationRefresh,
    beginDirectorySourceAdministrationRefresh,
    INITIAL_DIRECTORY_ADMINISTRATION_STATE,
    INITIAL_DIRECTORY_SOURCE_ADMINISTRATION_STATE,
    settleDirectoryAdministrationRefresh,
    settleDirectorySourceAdministrationRefresh,
} from './directoryAdministrationState';

function source(): TeamDirectorySourceSummaryV1 {
    return {
        v: 1,
        id: 'directory-1',
        teamId: 'team-1',
        kind: 'workos_directory',
        displayName: 'Acme directory',
        state: 'paused',
        allowedActions: ['teams.directory.sources.resume', 'teams.directory.sources.remove'],
        sync: {
            mode: 'events_and_full',
            attempt: 'paused',
            freshness: 'stale',
            lastAttemptAt: '2026-09-01T10:00:00Z',
            lastSuccessAt: '2026-09-01T09:55:00Z',
            lastFullReconcileAt: '2026-09-01T09:55:00Z',
            nextScheduledAt: null,
        },
        error: null,
    };
}

describe('directoryAdministrationState', () => {
    it('retains the last server projection when refresh fails', () => {
        const loaded = settleDirectoryAdministrationRefresh(INITIAL_DIRECTORY_ADMINISTRATION_STATE, {
            ok: true,
            items: [source()],
            nextCursor: null,
        });
        const failed = settleDirectoryAdministrationRefresh(beginDirectoryAdministrationRefresh(loaded), {
            ok: false,
            failure: { code: 'home_unreachable', retryable: true },
        });

        expect(failed.kind).toBe('ready');
        expect(failed.kind === 'ready' && failed.items[0]?.state).toBe('paused');
        expect(failed.kind === 'ready' && failed.stale).toBe(true);
    });

    it('retains an exact source projection when its refresh fails', () => {
        const loaded = settleDirectorySourceAdministrationRefresh(
            INITIAL_DIRECTORY_SOURCE_ADMINISTRATION_STATE,
            { ok: true, item: source() },
        );
        const failed = settleDirectorySourceAdministrationRefresh(
            beginDirectorySourceAdministrationRefresh(loaded),
            { ok: false, failure: { code: 'home_unreachable', retryable: true } },
        );

        expect(failed.kind).toBe('ready');
        expect(failed.kind === 'ready' && failed.item.id).toBe('directory-1');
        expect(failed.kind === 'ready' && failed.stale).toBe(true);
    });
});
