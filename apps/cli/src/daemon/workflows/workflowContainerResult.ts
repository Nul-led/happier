import type { WorkflowCoordinatorInvocation, WorkflowCoordinatorStore } from './coordinator';
import { WorkflowInputResolutionError, type WorkflowJsonValue } from './input';

/** A persisted selector is expanded only for an actual result consumer. */
export async function materializeWorkflowContainerResult(
  record: WorkflowCoordinatorInvocation,
  store: Pick<WorkflowCoordinatorStore, 'listCurrentMembers' | 'readByLogicalInvocation'>,
  resolveWorkflowOutput?: (record: WorkflowCoordinatorInvocation) => Promise<WorkflowJsonValue>,
): Promise<WorkflowJsonValue | undefined> {
  if (record.result !== undefined) return record.result;
  if (record.lifecycle !== 'completed' || !record.containerResult) return undefined;
  if (record.blockKind === 'workflow') {
    if (!resolveWorkflowOutput) throw new WorkflowInputResolutionError('missing_reference');
    return await resolveWorkflowOutput(record);
  }
  const children = await store.listCurrentMembers(record.key);
  const rows = await Promise.all(children.map((index) => store.readByLogicalInvocation(index.id)));
  if (rows.some((row) => !row)) throw new WorkflowInputResolutionError('missing_reference');
  const valueOf = async (row: WorkflowCoordinatorInvocation): Promise<WorkflowJsonValue | undefined> =>
    row.lifecycle === 'completed' ? row.result !== undefined ? row.result
      : await materializeWorkflowContainerResult(row, store, resolveWorkflowOutput) : undefined;
  if (record.container?.kind === 'parallel' || record.container?.kind === 'loop') {
    return await Promise.all(rows.map(async (row) => {
      if (!row) throw new WorkflowInputResolutionError('missing_reference');
      if (record.container?.kind === 'parallel') {
        if (row.frame?.source.kind !== 'branch') throw new WorkflowInputResolutionError('invalid_reference_scope');
        return row.lifecycle === 'completed'
          ? { branchId: row.frame.source.branchId, status: 'completed', results: await valueOf(row) ?? {} }
          : { branchId: row.frame.source.branchId, status: 'failed', reason: row.reason ?? row.lifecycle };
      }
      if (record.container?.kind === 'loop' && record.container.mode === 'items') {
        if (row.frame?.source.kind !== 'item') throw new WorkflowInputResolutionError('invalid_reference_scope');
        const index = Number(row.frame.source.index);
        return row.lifecycle === 'completed'
          ? { index, status: 'completed', results: await valueOf(row) ?? {} }
          : { index, status: 'failed', reason: row.reason ?? row.lifecycle };
      }
      return await valueOf(row) ?? null;
    }));
  }
  const result: Record<string, WorkflowJsonValue> = {};
  for (const row of rows) {
    if (!row) throw new WorkflowInputResolutionError('missing_reference');
    const value = await valueOf(row);
    if (value === undefined) continue;
    result[row.blockId] = value;
    // Branch exports belong to the containing lexical list as well as the
    // parallel collection; neither is a second persisted result copy.
    if (row.container?.kind === 'parallel' && Array.isArray(value)) {
      for (const outcome of value) {
        if (outcome && typeof outcome === 'object' && !Array.isArray(outcome)
          && typeof outcome.branchId === 'string' && outcome.status === 'completed' && outcome.results !== undefined) {
          result[outcome.branchId] = outcome.results;
        }
      }
    }
  }
  return result;
}
