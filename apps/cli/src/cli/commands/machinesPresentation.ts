import { definitionList } from '@happier-dev/cli-common/output';

import type { ActionCliPresentation } from '@/cli/actions/commandPresentation';
import { printJsonEnvelope } from '@/cli/output/jsonEnvelope';

type MachineRow = Readonly<{
  id: string;
  active: boolean;
  revokedAt: number | null;
  replacedByMachineId: string | null;
}>;

function readMachineRows(payload: unknown): readonly MachineRow[] {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const items = Array.isArray(record?.items) ? record.items : [];
  return items.flatMap((item): MachineRow[] => {
    const row = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : null;
    if (!row || typeof row.id !== 'string') return [];
    return [{
      id: row.id,
      active: row.active === true,
      revokedAt: typeof row.revokedAt === 'number' ? row.revokedAt : null,
      replacedByMachineId: typeof row.replacedByMachineId === 'string' ? row.replacedByMachineId : null,
    }];
  });
}

/**
 * `happier machines list` keeps its released `machines_list` envelope and its
 * `<id>  <state>` table. Only its input grammar and its invocation moved to the
 * canonical `machines.list` Action.
 */
export const MACHINES_LIST_PRESENTATION: ActionCliPresentation = {
  presentSuccess: async (payload, context) => {
    const machines = readMachineRows(payload);
    if (context.json) {
      await printJsonEnvelope({ ok: true, kind: 'machines_list', data: { machines } });
      return true;
    }
    console.log(machines.length
      ? definitionList(machines.map((machine) => ({
        label: machine.id,
        value: `${machine.revokedAt !== null ? 'revoked' : machine.active ? 'active' : 'inactive'}${
          machine.replacedByMachineId ? ` -> ${machine.replacedByMachineId}` : ''
        }`,
      })))
      : '(no machines registered)');
    return true;
  },
};
