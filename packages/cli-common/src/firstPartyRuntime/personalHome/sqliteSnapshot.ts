import { stat } from 'node:fs/promises';

export class PersonalHomeSqliteSnapshotError extends Error { constructor(public readonly code:'sqlite_snapshot_unstable'|'sqlite_check_failed'|'sqlite_maintenance_required', message:string){super(message);} }
export async function assertStablePersonalHomeSqliteSnapshot(params: Readonly<{ databasePath:string; checkpoint:()=>Promise<{busy:number}>; quickCheck:()=>Promise<boolean>; checkSidecars?: boolean }>): Promise<void> {
  const result=await params.checkpoint();
  if(result.busy!==0) throw new PersonalHomeSqliteSnapshotError('sqlite_snapshot_unstable','SQLite checkpoint did not complete');
  if(!(await params.quickCheck())) throw new PersonalHomeSqliteSnapshotError('sqlite_check_failed','SQLite quick_check failed');
  if (params.checkSidecars !== false) await assertPersonalHomeSqliteSidecarsStable(params.databasePath);
}
export async function assertPersonalHomeSqliteSidecarsStable(databasePath: string): Promise<void> { for(const suffix of ['-wal','-shm']) { try { const s=await stat(`${databasePath}${suffix}`); if(s.size>0) throw new PersonalHomeSqliteSnapshotError('sqlite_snapshot_unstable',`SQLite sidecar remains: ${suffix}`); } catch(e){ if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; } } }
