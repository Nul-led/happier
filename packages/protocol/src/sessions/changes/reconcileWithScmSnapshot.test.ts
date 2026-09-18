import { describe, expect, it } from 'vitest';

import type { ScmWorkingEntry, ScmWorkingSnapshot } from '../../scm/index.js';
import type { SessionChangeSet, TurnChangeSet } from './types.js';
import { mergeTurnChangeSets } from './mergeTurnChangeSets.js';
import { reconcileWithScmSnapshot } from './reconcileWithScmSnapshot.js';

function makeEntry(path: string, previousPath: string | null = null, kind = 'modified'): ScmWorkingEntry {
  return {
    path,
    previousPath,
    kind,
    includeStatus: '.',
    pendingStatus: 'M',
    hasIncludedDelta: false,
    hasPendingDelta: true,
    stats: {
      includedAdded: 0,
      includedRemoved: 0,
      pendingAdded: 1,
      pendingRemoved: 0,
      isBinary: false,
    },
  };
}

function makeTurn(files: TurnChangeSet['files'], turnId: string, startSeqInclusive: number): TurnChangeSet {
  return {
    sessionId: 'session-1',
    turnId,
    seqRange: { startSeqInclusive, endSeqInclusive: startSeqInclusive + 1 },
    status: 'completed',
    files,
    provider: 'codex',
    derivedAt: startSeqInclusive,
  };
}

function makeSnapshot(rootPath: string, entries: readonly ScmWorkingEntry[]): ScmWorkingSnapshot {
  return {
    projectKey: `project:${rootPath}`,
    fetchedAt: 1,
    repo: {
      isRepo: true,
      rootPath,
      backendId: 'git',
      mode: '.git',
      worktrees: [],
      remotes: [],
    },
    capabilities: {
      readStatus: true,
      readDiffFile: true,
      readDiffCommit: true,
      readLog: true,
      writeInclude: true,
      writeExclude: true,
      writeCommit: true,
      writeCommitPathSelection: true,
      writeCommitLineSelection: true,
      writeBackout: true,
      writeRemoteFetch: true,
      writeRemotePull: true,
      writeRemotePush: true,
      worktreeCreate: true,
      changeSetModel: 'working-copy',
      supportedDiffAreas: ['pending'],
    },
    branch: {
      head: 'main',
      upstream: null,
      ahead: 0,
      behind: 0,
      detached: false,
    },
    stashCount: 0,
    hasConflicts: false,
    entries: [...entries],
    totals: {
      includedFiles: 0,
      pendingFiles: entries.length,
      untrackedFiles: 0,
      includedAdded: 0,
      includedRemoved: 0,
      pendingAdded: 1,
      pendingRemoved: 0,
    },
  };
}

function makeChangeSet(filePath: string): SessionChangeSet {
  return {
    sessionId: 'session-1',
    turns: [],
    files: [{
      filePath,
      changeKind: 'modified',
      oldText: null,
      newText: null,
      source: 'provider_native',
      confidence: 'exact',
      provider: 'codex',
      turns: ['turn-1'],
      attribution: { confidence: 'session_exact', reason: 'provider_correlated' },
      checkpointOverlap: 'unknown',
    }],
    rolledBackTurnIds: [],
    confidenceSummary: {
      source: 'provider_native',
      confidence: 'exact',
      attribution: { confidence: 'session_exact', reason: 'provider_correlated' },
      checkpointOverlap: 'unknown',
    },
  };
}

describe('reconcileWithScmSnapshot', () => {
  it('reconciles edit-to-rename lineage as one destination match', () => {
    const baseEvidence = {
      changeKind: 'modified',
      source: 'provider_tool',
      confidence: 'strong',
      provider: 'codex',
      agentTurnId: 'provider-turn-1',
    } as const;
    const sessionChangeSet = mergeTurnChangeSets({
      sessionId: 'session-1',
      turns: [
        makeTurn([{ ...baseEvidence, filePath: 'src/old.ts' }], 'turn-1', 1),
        makeTurn([{
          ...baseEvidence,
          filePath: 'src/new.ts',
          previousFilePath: 'src/old.ts',
          changeKind: 'renamed',
          agentTurnId: 'provider-turn-2',
        }], 'turn-2', 3),
      ],
    });

    const projection = reconcileWithScmSnapshot({
      sessionChangeSet,
      snapshot: makeSnapshot('/repo', [makeEntry('src/new.ts', 'src/old.ts', 'renamed')]),
    });

    expect(projection.matchedFiles).toHaveLength(1);
    expect(projection.matchedFiles[0]).toMatchObject({
      filePath: 'src/new.ts',
      repositoryPath: 'src/new.ts',
      sessionChange: { turns: ['turn-1', 'turn-2'] },
    });
    expect(projection.unmatchedSessionFiles).toEqual([]);
    expect(projection.repositoryOnlyFiles).toEqual([]);
  });

  it('does not reconcile separate copy and source evidence to the same repository entry', () => {
    const source = makeChangeSet('src/original.ts').files[0]!;
    const copy = {
      ...source,
      filePath: 'src/copy.ts',
      previousFilePath: 'src/original.ts',
      changeKind: 'copied' as const,
      turns: ['turn-2'],
    };

    for (const files of [[copy, source], [source, copy]]) {
      const sessionChangeSet: SessionChangeSet = {
        ...makeChangeSet('src/original.ts'),
        files,
      };
      const projection = reconcileWithScmSnapshot({
        sessionChangeSet,
        snapshot: makeSnapshot('/repo', [makeEntry('src/copy.ts', 'src/original.ts', 'copied')]),
      });

      expect(projection.matchedFiles.map((file) => file.filePath)).toEqual(['src/copy.ts']);
      expect(projection.unmatchedSessionFiles.map((file) => file.filePath)).toEqual(['src/original.ts']);
    }
  });

  it('matches provider absolute paths underneath the repository root to SCM relative paths', () => {
    const projection = reconcileWithScmSnapshot({
      sessionChangeSet: makeChangeSet('/repo/src/app.ts'),
      snapshot: makeSnapshot('/repo', [makeEntry('src/app.ts')]),
    });

    expect(projection.matchedFiles.map((file) => file.repositoryPath)).toEqual(['src/app.ts']);
    expect(projection.unmatchedSessionFiles).toEqual([]);
  });

  it('does not treat sibling absolute paths as inside the repository root', () => {
    const projection = reconcileWithScmSnapshot({
      sessionChangeSet: makeChangeSet('/repo-other/src/app.ts'),
      snapshot: makeSnapshot('/repo', [makeEntry('src/app.ts')]),
    });

    expect(projection.matchedFiles).toEqual([]);
    expect(projection.unmatchedSessionFiles.map((file) => file.filePath)).toEqual(['/repo-other/src/app.ts']);
  });

  it('matches Windows provider absolute paths underneath the repository root', () => {
    const projection = reconcileWithScmSnapshot({
      sessionChangeSet: makeChangeSet('C:\\Users\\Alice\\repo\\src\\app.ts'),
      snapshot: makeSnapshot('c:\\users\\alice\\repo', [makeEntry('src/app.ts')]),
    });

    expect(projection.matchedFiles.map((file) => file.repositoryPath)).toEqual(['src/app.ts']);
    expect(projection.unmatchedSessionFiles).toEqual([]);
  });

  it('matches UNC provider absolute paths underneath a share-root repository', () => {
    const projection = reconcileWithScmSnapshot({
      sessionChangeSet: makeChangeSet('\\\\server\\share\\src\\app.ts'),
      snapshot: makeSnapshot('\\\\server\\share', [makeEntry('src/app.ts')]),
    });

    expect(projection.matchedFiles.map((file) => file.repositoryPath)).toEqual(['src/app.ts']);
    expect(projection.unmatchedSessionFiles).toEqual([]);
  });
});
