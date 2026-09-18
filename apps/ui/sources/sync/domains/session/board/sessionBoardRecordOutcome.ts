import type { OpenSessionSystemRecordResult } from '@/sync/domains/sessionSystemRecords/codec';
import type { SessionSystemRecordRepositoryEntry } from '@/sync/domains/sessionSystemRecords/repository';

/** Board consumes the canonical record codec and repository lifecycle vocabulary. */
export type SessionBoardRecordOpenOutcome<TValue> = OpenSessionSystemRecordResult<TValue>;
export type SessionBoardRecordFreshness = SessionSystemRecordRepositoryEntry<unknown>['freshness'];
export type SessionBoardRecordReachability = SessionSystemRecordRepositoryEntry<unknown>['reachability'];
export type SessionBoardRecordLoading = SessionSystemRecordRepositoryEntry<unknown>['loading'];

/** A real row retains its opaque CAS revision even when its content cannot open. */
export type SessionBoardOpenedRecord<TValue> = Readonly<{
    revision: string;
    outcome: SessionBoardRecordOpenOutcome<TValue>;
}>;
