import type { OptionPickerProbeState } from '@/components/sessions/pickers/OptionPickerOverlay';
import type { CLIAvailability } from '@/agents/machineAgents/machineAgentCliAvailability';

export function buildCliAvailabilityProbeState(params: Readonly<{
    selectedMachineId: string | null;
    cliAvailability: CLIAvailability;
    onRefresh: () => void;
}>): OptionPickerProbeState | undefined {
    if (!params.selectedMachineId) return undefined;

    return {
        phase: params.cliAvailability.isDetecting
            ? (params.cliAvailability.timestamp > 0 ? 'refreshing' : 'loading')
            : 'idle',
        onRefresh: params.onRefresh,
    };
}
