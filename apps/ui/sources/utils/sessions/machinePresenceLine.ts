import { t } from '@/text';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { formatLastSeen } from '@/utils/sessions/sessionUtils';

export type MachinePresenceLine = Readonly<{
    online: boolean;
    /** "Online", or "Offline · last seen 4 days ago". */
    label: string;
}>;

/**
 * The presence half of a machine's status line, shared by every surface that lists machines with a
 * status line (the home hub's Machines section, the machine picker rows), so a machine reads the
 * same wherever it appears. Callers append their own facts after it ("· Update available").
 */
export function describeMachinePresenceLine(
    machine: Readonly<{ active: boolean; activeAt?: number | null; revokedAt?: number | null }>,
    nowMs?: number,
): MachinePresenceLine {
    const online = isMachineOnline(machine, nowMs);
    return {
        online,
        label: online
            ? t('settingsOverview.machineOnline')
            : t('settingsOverview.machineOffline', { lastSeen: formatLastSeen(machine.activeAt ?? 0) }),
    };
}
