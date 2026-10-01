import { t } from '@/text';

import { summarizePluginMachines, type PluginMachineMatrixV1 } from './pluginMachineMatrix';

/**
 * Where each plugin runs, as the Plugins collection's card line: "On 3 machines", or the machine's
 * name when it runs on one. A plugin current nowhere, or an unloaded matrix, has no line.
 */
export function resolvePluginMachineCoverageLabels(matrix: PluginMachineMatrixV1): Readonly<Record<string, string>> {
    if (matrix.kind !== 'available') return {};
    const labels: Record<string, string> = {};
    for (const row of matrix.rows) {
        const summary = summarizePluginMachines(row, matrix.machineCount);
        if (summary.currentCount > 1) {
            labels[row.pluginId] = t('settingsPlugins.surfaces.onMachines', { count: summary.currentCount });
        } else if (summary.currentCount === 1 && summary.currentNames[0]) {
            labels[row.pluginId] = t('settingsPlugins.surfaces.onMachine', { machine: summary.currentNames[0] });
        }
    }
    return Object.freeze(labels);
}
