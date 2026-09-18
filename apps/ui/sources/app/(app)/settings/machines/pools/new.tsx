import { useLocalSearchParams } from 'expo-router';
import { MachinePoolEditorRoute } from '@/components/settings/machines/pools/MachinePoolEditorScreen';

export default function NewMachinePoolRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    return <MachinePoolEditorRoute params={params} />;
}
