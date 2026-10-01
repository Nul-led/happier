import type {
    ScmStashApplyResponse,
    ScmStashDropResponse,
    ScmStashListResponse,
    ScmStashPopResponse,
    ScmStashShowResponse,
} from '@happier-dev/protocol';

export type ScmStashDetailsAdapter = Readonly<{
    list: () => Promise<ScmStashListResponse>;
    show: (stashRef: string) => Promise<ScmStashShowResponse>;
    pop: (stashRef: string) => Promise<ScmStashPopResponse>;
    drop: (stashRef: string) => Promise<ScmStashDropResponse>;
    /** Puts the stash's changes back and keeps the stash (Restore also removes it). */
    apply: (stashRef: string) => Promise<ScmStashApplyResponse>;
}>;
